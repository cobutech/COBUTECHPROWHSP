const {
    jidNormalizedUser,
    delay,
    isJidGroup,
    getContentType
} = require('@whiskeysockets/baileys');

const fs   = require('fs');
const path = require('path');

const PRESENCE_TIMEOUTS = new Map();
let msgMemoryStore = [];

// ----------  HELPERS  ----------
const toCaps = (str) => String(str).toUpperCase();

const storeMessageLocal = (msgData) => {
    msgMemoryStore.push(msgData);
    if (msgMemoryStore.length > 1000) msgMemoryStore.shift();
};

const getMessageLocal = (msgId) => msgMemoryStore.find(m => m.message_id === msgId) || null;

const decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) return jidNormalizedUser(jid);
    return jid;
};

const clearPresenceTimeout = (chatJid) => {
    if (PRESENCE_TIMEOUTS.has(chatJid)) {
        clearTimeout(PRESENCE_TIMEOUTS.get(chatJid));
        PRESENCE_TIMEOUTS.delete(chatJid);
    }
};

const sendPresence = async (sock, chatJid, type, durationMs) => {
    clearPresenceTimeout(chatJid);
    await sock.sendPresenceUpdate(type, chatJid);
    const timeout = setTimeout(async () => {
        await sock.sendPresenceUpdate('paused', chatJid);
        PRESENCE_TIMEOUTS.delete(chatJid);
    }, durationMs);
    PRESENCE_TIMEOUTS.set(chatJid, timeout);
};

const startAutoRecordingTypingSequence = async (sock, chatJid) => {
    await sock.sendPresenceUpdate('composing', chatJid);
    await delay(15000);
    await sock.sendPresenceUpdate('recording', chatJid);
    await delay(15000);
    await sock.sendPresenceUpdate('paused', chatJid);
};

// ----------  AUTO-LOAD COMMANDS  ----------
const commands = [];
const cmdDir = path.join(__dirname, 'COBUWAP');
if (fs.existsSync(cmdDir)) {
    fs.readdirSync(cmdDir).forEach(file => {
        if (file.endsWith('.js')) {
            const cmd = require(path.join(cmdDir, file));
            // single export
            if (cmd.name) commands.push(cmd);
            // multiple exports in same file
            Object.values(cmd).forEach(sub => { if (sub.name) commands.push(sub); });
        }
    });
}

// ----------  MAIN LOGIC  ----------
const startBotLogic = async (sock, ownerJid, getBotSettingsByJid, getDeveloperContact) => {
    const cleanOwnerJid = decodeJid(ownerJid);
    const getFreshSettings = async () => await getBotSettingsByJid(cleanOwnerJid);

    const initSettings = await getFreshSettings();
    if (initSettings?.always_online) await sock.sendPresenceUpdate('available');
    else await sock.sendPresenceUpdate('unavailable');

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        const m = messages[0];
        if (!m.message) return;

        const chatJid = m.key.remoteJid;
        const rawSenderJid = m.key.participant || (m.key.fromMe ? sock.user.id : chatJid);
        const senderJid = decodeJid(rawSenderJid);
        const isMe = m.key.fromMe;
        const isOwner = senderJid === cleanOwnerJid;
        const isGroup = isJidGroup(chatJid);

        const settings = await getFreshSettings();
        if (!settings) return;

        const prefix = settings.prefix || '';
        if (prefix === '') return;                       // ignore if no prefix set
        const mode = settings.mode || 'public';
        const sudoJids = settings.sudo_numbers ? settings.sudo_numbers.split(',') : [];
        const isSudo = isOwner || sudoJids.includes(senderJid);

        // auto presence / read
        if (!isMe) {
            if (settings.autorecordingtyping) startAutoRecordingTypingSequence(sock, chatJid);
            else if (settings.auto_typing) sendPresence(sock, chatJid, 'composing', 25000);
            else if (settings.auto_recording) sendPresence(sock, chatJid, 'recording', 25000);
            if (settings.autoread) await sock.readMessages([m.key]);
        }

        // anti-delete store
        if (settings.anti_delete) {
            const messageContentType = getContentType(m.message);
            if (messageContentType) {
                const text = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
                const chatName = isGroup ? (await sock.groupMetadata(chatJid)).subject : m.pushName || senderJid.split('@')[0];
                storeMessageLocal({
                    message_id: m.key.id,
                    message_text: text,
                    sender_jid: senderJid,
                    chat_jid: chatJid,
                    chat_name: chatName,
                    is_group: isGroup,
                    timestamp: new Date()
                });
            }
        }

        // command parsing
        const messageText = m.message?.conversation ||
                            m.message?.extendedTextMessage?.text ||
                            m.message?.imageMessage?.caption || '';

        const commonPrefixes = ['!', '#', '/', '$'];
        const startsWithWrongPrefix = commonPrefixes.some(p => messageText.startsWith(p));
        const isCorrectPrefix = messageText.startsWith(prefix);

        if (!isCorrectPrefix && startsWithWrongPrefix && messageText.length > 1) {
            if (mode === 'public' || isSudo) {
                return await sock.sendMessage(chatJid, {
                    text: toCaps(`❌ WRONG PREFIX!\n\nTHE SET PREFIX IS: *${prefix}*\nPLEASE USE: *${prefix}${messageText.slice(1)}*`)
                }, { quoted: m });
            }
        }

        if (isCorrectPrefix) {
            if (mode === 'private' && !isSudo) return;
            if (isSudo && !isOwner && isGroup) return;

            const input = messageText.slice(prefix.length).trim().split(/\s+/);
            const cmdName = input[0].toLowerCase();
            const args = input.slice(1);

            const cmd = commands.find(c => c.name === cmdName);
            if (!cmd) {
                return await sock.sendMessage(chatJid, {
                    text: toCaps(`🚧 COMMAND *${cmdName}* NOT FOUND.`)
                }, { quoted: m });
            }

            // owner-only gate
            if (cmd.ownerOnly && !isOwner) {
                const tech = await getFreshSettings();   // table `tech` has bot_name
                const botName = tech?.bot_name || 'BOT';
                return await sock.sendMessage(chatJid, {
                    text: toCaps(`THIS COMMAND CAN ONLY BE USED BY THE OWNER`)
                }, { quoted: m });
            }

            // run it
            try { await cmd.exec(sock, m, args, cleanOwnerJid, { isForwarded: true, forwardingScore: 999 }); }
            catch (e) {
                await sock.sendMessage(chatJid, {
                    text: toCaps(`ERROR EXECUTING COMMAND: ${e.message}`)
                }, { quoted: m });
            }
            return;
        }
    });

    // ----------  ANTI-DELETE REPORT  ----------
    sock.ev.on('messages.update', async (updates) => {
        const settings = await getFreshSettings();
        if (!settings?.anti_delete) return;

        for (const update of updates) {
            if (update.update.message === null) {
                const deletedData = getMessageLocal(update.key.id);
                if (!deletedData) continue;

                const isGroup = deletedData.is_group;
                const deletedFrom = isGroup ? deletedData.chat_name : deletedData.sender_jid.split('@')[0];
                const senderName = deletedData.sender_jid.split('@')[0];
                const senderNum  = deletedData.sender_jid;

                const reportText = toCaps(`
*╭━━• DELETED MESSAGE DETECTED •━━*
*┃*
*┃ DELETED FROM:* ${deletedFrom}
*┃ ORIGINAL TEXT:* ${deletedData.message_text}
*┃*
*┃ TIME AND DATE:* ${new Date(deletedData.timestamp).toLocaleString()}
*┃ SENT BY:* ${senderName} (${senderNum})
*┃ DELETED FROM:* ${isGroup ? 'GROUP CHAT' : 'PRIVATE DM'}
*╰━━• END OF MESSAGE •━━*
                `.trim());

                await sock.sendMessage(deletedData.chat_jid, {
                    text: reportText,
                    mentions: [deletedData.sender_jid]
                });
            }
        }
    });
};

module.exports = {
    startBotLogic,
    sendPresence,
    startAutoRecordingTypingSequence
};
