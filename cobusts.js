const {
    jidNormalizedUser,
    delay,
    WAMessageStubType,
    isJidGroup,
    getContentType
} = require('@whiskeysockets/baileys');

const PRESENCE_TIMEOUTS = new Map();
let msgMemoryStore = [];

const storeMessageLocal = (msgData) => {
    msgMemoryStore.push(msgData);
    if (msgMemoryStore.length > 1000) {
        msgMemoryStore.shift();
    }
};

const getMessageLocal = (msgId) => {
    return msgMemoryStore.find(m => m.message_id === msgId) || null;
};

const decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
        return jidNormalizedUser(jid);
    }
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

const startBotLogic = async (sock, ownerJid, getBotSettingsByJid, getDeveloperContact, getBotConfig) => {

    const cleanOwnerJid = decodeJid(ownerJid);

    const getFreshSettings = async () => {
        return await getBotSettingsByJid(cleanOwnerJid);
    };

    const initSettings = await getFreshSettings();
    if (initSettings?.always_online) {
        await sock.sendPresenceUpdate('available');
    } else {
        await sock.sendPresenceUpdate('unavailable');
    }

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

        const prefix = settings.prefix;
        const mode = settings.mode || 'public';
        const sudoJids = settings.sudo_numbers ? settings.sudo_numbers.split(',') : [];
        const isSudo = isOwner || sudoJids.includes(senderJid);

        if (!isMe) {
            if (settings.autorecordingtyping) {
                startAutoRecordingTypingSequence(sock, chatJid);
            } else if (settings.auto_typing) {
                sendPresence(sock, chatJid, 'composing', 25000);
            } else if (settings.auto_recording) {
                sendPresence(sock, chatJid, 'recording', 25000);
            }

            if (settings.autoread) {
                await sock.readMessages([m.key]);
            }
        }

        if (settings.anti_delete) {
            const messageContentType = getContentType(m.message);
            if (messageContentType) {
                const text = m.message?.conversation || m.message?.extendedTextMessage?.text || m.message?.imageMessage?.caption || m.message?.videoMessage?.caption || '';
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

        const messageText = m.message?.conversation || 
                            m.message?.extendedTextMessage?.text || 
                            m.message?.imageMessage?.caption || 
                            '';

        const isCorrectPrefix = prefix && messageText.startsWith(prefix);
        
        if (isCorrectPrefix) {
            
            const botConfig = await getBotConfig(cleanOwnerJid); 
            const botName = botConfig?.bot_name;
            const botVersion = botConfig?.bot_version;

            if (!botName || !botVersion) {
                const { developer_name, developer_number, channel_link } = await getDeveloperContact();
                
                const errorReply = `Dear ${m.pushName} the above ${chatJid} session is not having active bot, contact ${developer_name} through ${developer_number} to get help, follow ${channel_link} to see upcoming updates`;
                
                await sock.sendMessage(chatJid, { 
                    text: errorReply,
                    contextInfo: { isForwarded: true, forwardingScore: 999 }
                }, { quoted: m });
                
                return;
            }

            if (mode === 'private' && !isSudo) {
                return; 
            }

            if (isSudo && !isOwner && isGroup) {
                return; 
            }

            const command = messageText.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase();

            await delay(500);

            await sock.sendMessage(chatJid, {
                text: `🚧 *Command Not Implemented*\n\nThe command *${command}* is currently under construction.\n\nPrefix: ${prefix}\nMode: ${mode}`,
                contextInfo: {
                    isForwarded: true,
                    forwardingScore: 999
                }
            }, { quoted: m });

            await sock.sendPresenceUpdate('paused', chatJid);
        }
    });

    sock.ev.on('messages.update', async (updates) => {
        const settings = await getFreshSettings();
        if (!settings?.anti_delete) return;

        for (const update of updates) {
            if (update.update.message === null) { 
                
                const deletedMsg = update.update.message;
                const messageStubType = deletedMsg ? deletedMsg.messageStubType : WAMessageStubType.UNKNOWN;

                if (messageStubType === WAMessageStubType.GROUP_PARTICIPANT_REMOVE) {
                    continue;
                }
                
                const deletedData = getMessageLocal(update.key.id);

                if (deletedData) {
                    const chatType = deletedData.is_group ? `Group (${deletedData.chat_name})` : `DM (${deletedData.chat_name})`;
                    const deletedBy = update.key.participant ? `@${update.key.participant.split('@')[0]}` : 'Unknown';
                    
                    const reportText = `
═════════════════════════════
*☆♥︎𝑫𝑬𝑳𝑬𝑻𝑬𝑫 𝑴𝑨𝑺𝑺𝑨𝑮𝑬 𝑫𝑬𝑻𝑬𝑪𝑻𝑬𝑫♥︎☆*
═════════════════════════════
*𝑪𝑯𝑨𝑻*: ${deletedData.chat_name}
           ♥︎✦♥︎✦
*𝑺𝑬𝑵𝑻 𝑩𝒀*: @${deletedData.sender_jid.split('@')[0]}
           ♥︎✦♥︎✦
*𝑫𝑬𝑳𝑬𝑻𝑬𝑫 𝑩𝒀*: ${deletedBy}
           ♥︎✦♥︎✦
*𝑳𝑶𝑪𝑨𝑻𝑰𝑶𝑵*: ${chatType}
           ♥︎✦♥︎✦
*𝑻𝑰𝑴𝑬/𝑫𝑨𝑻𝑬*: ${deletedData.timestamp.toLocaleString()}
           ♥︎✦♥︎✦
*𝑴𝑨𝑺𝑺𝑨𝑮𝑬*: ${deletedData.message_text}
═════════════════════════════
> 𝑻𝑯𝑬 𝑷𝑶𝑾𝑬𝑹 𝑶𝑭 TECH INDUSTRIES
                    `.trim();

                    await sock.sendMessage(deletedData.chat_jid, { 
                        text: reportText,
                        mentions: [deletedData.sender_jid, update.key.participant].filter(Boolean)
                    });
                }
            }
        }
    });
};

module.exports = {
    startBotLogic,
    sendPresence,
    startAutoRecordingTypingSequence
};
