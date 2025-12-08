const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');
const P = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const { 
    initializeDatabase, 
    storeUserData, 
    markSessionOffline, 
    checkUserStatus, 
    getUserSettings, 
    getBotSettingsByJid, 
    getAvailableBots, 
    updateUserSettings, 
    getDeveloperContact, 
    checkIfOnline,
    saveSessionDataToDB,
    getSessionDataFromDB
} = require('./cobudbupdt');
const { startBotLogic } = require('./cobusts');

dotenv.config();
const sessionsDir = './sessions';
const PORT = process.env.PORT || 5000;
const ACTIVE_SESSIONS = new Map();
const PENDING_SESSIONS = new Map();
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir);
const normalizeNumber = n => {
    const c = n.replace(/[^0-9]/g, '');
    return c ? (c.endsWith('@s.whatsapp.net') ? c : `${c}@s.whatsapp.net`) : null;
};
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
app.get('/setup', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.post('/api/check-session', async (req, res) => {
    const { sessionName } = req.body;
    if (!sessionName) return res.json({ success: false, message: 'Session name required' });
    const folderPath = path.join(sessionsDir, sessionName);
    if (ACTIVE_SESSIONS.has(sessionName)) return res.json({ status: 'active', message: 'Session is already active.' });
    if (fs.existsSync(folderPath)) { startSessionBackend(sessionName); return res.json({ status: 'reconnecting', message: 'Session found. Reconnecting...' }); }
    return res.json({ status: 'new', message: 'Session not found. Create new.' });
});
app.post('/api/init-session', async (req, res) => {
    const { sessionName, method, phoneNumber } = req.body;
    startSessionBackend(sessionName, true, method, phoneNumber);
    res.json({ success: true, message: 'Initialization started' });
});
app.get('/api/session-poll', (req, res) => {
    const sessionName = req.query.sessionName;
    if (ACTIVE_SESSIONS.has(sessionName)) return res.json({ status: 'connected' });
    const pending = PENDING_SESSIONS.get(sessionName);
    if (pending) return res.json({ status: 'pending', qr: pending.qr, code: pending.code, message: pending.message });
    res.json({ status: 'waiting' });
});
app.post('/select-bot', async (req, res) => {
    const { number } = req.body;
    if (!number) return res.json({ success: false, message: 'Please provide a valid WhatsApp number.' });
    const userJid = normalizeNumber(number);
    const userStatus = await checkUserStatus(userJid);
    if (userStatus && userStatus.session_online) {
        if (userStatus.bot_name && userStatus.bot_version) {
            const settings = await getUserSettings(userJid);
            return res.json({ success: true, page: 'settings-bypass', number, userName: userStatus.whatsapp_name, settings });
        } else {
            const bots = await getAvailableBots();
            if (bots.length === 0) return res.json({ success: false, message: 'No active bots available at the moment.' });
            return res.json({ success: true, page: 'bot-selection', number, bots, userName: userStatus.whatsapp_name });
        }
    } else if (userStatus) {
        return res.json({ success: false, message: `User ${userStatus.whatsapp_name} is found but OFFLINE. Please connect on the Home page first.` });
    } else {
        return res.json({ success: false, message: 'User not found. Please connect your session first.' });
    }
});
app.post('/submit', async (req, res) => {
    const { number, botName, botVersion, userName, autoread, autoviewstatus, autorecordingtyping, autoTyping, autoRecording, antiDelete, alwaysOnline, mode, prefix, sudo1, sudo2, sudo3 } = req.body;
    const finalPrefix = prefix.trim();
    const devContact = await getDeveloperContact();
    const userJid = normalizeNumber(number);
    const finalSudoJIDs = new Set();
    const devJid = normalizeNumber(devContact.developer_number);
    if (devJid) finalSudoJIDs.add(devJid);
    [sudo1, sudo2, sudo3].forEach(n => { const j = normalizeNumber(n); if (j) finalSudoJIDs.add(j); });
    await updateUserSettings(userJid, botName, botVersion, autoread === 'true', autoviewstatus === 'true', autorecordingtyping === 'true', autoTyping === 'true', autoRecording === 'true', antiDelete === 'true', alwaysOnline === 'true', mode, finalPrefix, Array.from(finalSudoJIDs).join(','));
    const userStatus = await checkUserStatus(userJid);
    const sessionId = userStatus ? userStatus.session_id : null;
    const activeSock = sessionId ? ACTIVE_SESSIONS.get(sessionId) : null;
    if (activeSock) {
        const fullBotName = `${botName} 𝑽-${botVersion}`;
        const messageText = `
═════════════════════════════
     ═◇ 𝑺𝑼𝑪𝑪𝑬𝑺𝑺𝑭𝑼𝑳𝑳𝒀 𝑪𝑶𝑵𝑬𝑪𝑻𝑬𝑫  ◇═
═════════════════════════════
                                 ◇ 𝑻𝑶 ◇
═════════════════════════════
 ♥︎✦♥︎ ═══♤♡${fullBotName}♤♡═══♥︎✦♥︎
═════════════════════════════
𝑷𝑳𝑬𝑨𝑺𝑬 𝑼𝑺𝑬  ${fullBotName}  𝑾𝑰𝑻𝑯 𝑪𝑨𝑹𝑬 𝑻𝑶 𝑨𝑽𝑶𝑰𝑫 𝑨𝑪𝑪𝑶𝑼𝑵𝑻 𝑩𝑨𝑵 𝑭𝑶𝑹𝑴 𝑻𝐇𝐄  𝑪𝑶𝐁𝐔𝐓𝐄𝐂𝐇𝐈𝐍𝐃𝐔𝐒𝐓𝐑𝒀 𝑪𝑶𝑴𝑴𝑼𝑵𝑰𝒀
═════════════════════════════
𝑯𝑨𝑽𝑰𝑵𝑮 𝑰𝑺𝑺𝑼𝑬𝑺 𝑫𝑶𝑵'𝑻 𝑯𝐄𝐒𝐈𝐓𝐀𝐓𝐄 𝑻𝑶 𝑪𝑶𝑵𝑻𝐀𝐂𝐓  ${devContact.developer_name} 𝑻𝐇𝐑𝐎𝐔𝐆𝐇  ${devContact.developer_number}
═════════════════════════════
𝑭𝑶𝐋𝐋𝐎𝐖 𝑴𝒀 𝑪𝐇𝐀𝐍𝐍𝐄𝐋 𝑭𝑶𝑹 𝑴𝑶𝑹𝐄 𝑼𝑷𝐃𝐀𝐓𝐄𝐒 :${devContact.channel_link}
🗿🗿🗿🗿🗿🗿🗿🗿🗿🗿🗿🗿
> 𝑻𝐇𝐄 𝑷𝑶𝑾𝐄𝑹 𝑶𝐅 ${fullBotName}
═════════════════════════════
`.trim();
        try {
            if (fs.existsSync('techmain.jpg')) {
                await activeSock.sendMessage(userJid, {
                    image: fs.readFileSync('techmain.jpg'),
                    caption: messageText,
                    contextInfo: { externalAdReply: { sourceUrl: devContact.channel_link, title: "𝑪𝑶𝑩𝑼𝑻𝑬𝑪𝑯𝑰𝑵𝑫𝑼𝑺𝑻𝑹𝒀🌐", body: "" } }
                });
            } else await activeSock.sendMessage(userJid, { text: messageText });
        } catch {}
    }
    res.json({ success: true, page: 'finish', botName, userName });
});
async function startSessionBackend(sessionName, isNew = false, method = null, phoneNumber = null) {
    const folderPath = path.join(sessionsDir, sessionName);
    
    if (!fs.existsSync(folderPath) || !fs.existsSync(path.join(folderPath, 'creds.json'))) {
        const storedCreds = await getSessionDataFromDB(sessionName); 
        if (storedCreds) {
            if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
            fs.writeFileSync(path.join(folderPath, 'creds.json'), storedCreds, 'utf8');
        }
    }

    PENDING_SESSIONS.set(sessionName, { qr: null, code: null, message: 'Starting...' });
    const { state, saveCreds } = await useMultiFileAuthState(folderPath);
    const { version } = await fetchLatestBaileysVersion();
    const logger = P({ level: 'silent' });
    const sock = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
        printQRInTerminal: false, 
        logger, 
        browser: ["Ubuntu", "Chrome", "20.0.04"], 
        version, 
        connectTimeoutMs: 60000,
        syncFullHistory: false,
        keepAliveIntervalMs: 10000
    });
    if (isNew && method === 'pairing' && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                PENDING_SESSIONS.set(sessionName, { code, message: 'Code Generated' });
            } catch {
                PENDING_SESSIONS.set(sessionName, { message: 'Error generating code' });
            }
        }, 6000);
    }
    sock.ev.on('connection.update', async (update) => {
        const { qr, connection, lastDisconnect } = update;
        if (qr && isNew && method === 'qr') {
            const qrUrl = await QRCode.toDataURL(qr);
            PENDING_SESSIONS.set(sessionName, { qr: qrUrl, message: 'Scan QR' });
        }
        if (connection === 'open') {
            const rawId = sock.user.id;
            const userJid = jidNormalizedUser(rawId);
            const userName = sock.user.name || sock.user.notify || sessionName;
            ACTIVE_SESSIONS.set(sessionName, sock);
            PENDING_SESSIONS.delete(sessionName);
            await storeUserData(userJid, userName, sessionName);
            const devContact = await getDeveloperContact();
            await startBotLogic(sock, userJid, getBotSettingsByJid, getDeveloperContact);
            const userStatus = await checkUserStatus(userJid);
            const isOnline = await checkIfOnline(userJid);
            let welcomeMsg, fullBotName;

            if (!isOnline || isNew) {
                fullBotName = 'Unknown';
                welcomeMsg = `
╔════◇𝑾𝑬𝑳𝑪𝑶𝑴𝑬◇═══◇
   ◇══◇ ${userName} ◇══◇
                       ◇  𝑻𝑶 ◇
       🤖 𝑪𝑶𝑩𝑼-𝑻𝑬𝑪𝑯-𝑰𝑵𝑫𝑼𝑺𝑻𝑹𝒀 🤖
        ═𝐄𝑁𝐉𝑂𝑌 𝑰𝑻'𝑺 𝑷𝑶𝑾𝐄𝑹 𝑶𝐅◇══
`.trim();
            } else {
                const botSettings = await getBotSettingsByJid(userJid);
                fullBotName = `${botSettings.bot_name || 'Unknown'} V-${botSettings.bot_version || '0.0'}`;
                welcomeMsg = `
♥︎✦♥︎✦♥︎𝑾𝑬𝑳𝑪𝑶𝑴𝑬 𝑩𝑨𝑪𝑲♥︎✦♥︎✦♥︎
 ◇══◇ ${userName} ◇══◇ 
                             𝒀𝑶𝑼𝑹 
◇══◇${sessionName}◇══◇ 
 𝑩𝑬𝑬𝑵  𝑺𝑼𝑪𝑪𝑬𝑺𝑺𝑭𝑼𝒀 𝑹𝑬𝑪𝑶𝑵𝑵𝑬𝑪𝑻𝑬𝑫 
> 𝑻𝑯𝑬 𝑷𝑶𝑾𝑬𝑹 𝑶𝑭 𝑻𝑬𝑪𝑯 𝑰𝑵𝑫𝑼𝑺𝑻𝑹𝑰𝑬'𝑺
            `.trim();
            }

            try {
                if (fs.existsSync('techmain.jpg')) {
                    await sock.sendMessage(userJid, {
                        image: fs.readFileSync('techmain.jpg'),
                        caption: welcomeMsg,
                        contextInfo: { externalAdReply: { sourceUrl: devContact.channel_link, title: "𝑪𝑶𝑩𝑼𝑻𝑬𝑪𝑯𝑰𝑵𝑫𝑼𝑺𝑻𝑹𝒀🌐", body: "" } }
                    });
                } else await sock.sendMessage(userJid, { text: welcomeMsg });
            } catch {}
            if (!userStatus.bot_name || !userStatus.bot_version) {
                const noBotText = `
𝑫𝑬𝑨𝑹 ${userName}, 𝑻𝑯𝑬 𝑺𝑬𝑺𝑺𝑰𝑶𝑵 ${sessionName} 𝑯𝑨𝑺 𝑵𝑶 𝑨𝑪𝑻𝑰𝑽𝑬 𝑩𝑶𝑻.
𝑪𝑶𝑵𝑻𝑨𝑪𝑻 ${devContact.developer_name} 𝑻𝑯𝑹𝑶𝑼𝑮𝑯 ${devContact.developer_number}
𝑭𝑶𝑳𝑳𝑶𝑾 𝑼𝑷𝑫𝑨𝑻𝑬𝑺: ${devContact.channel_link}
> 𝑻𝑯𝑬 𝑷𝑶𝑾𝑬𝑹 𝑶𝑭 𝑻𝑬𝑪𝑯 𝑰𝑵𝑫𝑼𝑺𝑻𝑹𝒀
                `.trim();
                await sock.sendMessage(userJid, { text: noBotText });
            }
        }
        if (connection === 'close') {
            ACTIVE_SESSIONS.delete(sessionName);
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (sock.user?.id) await markSessionOffline(jidNormalizedUser(sock.user.id));
            if (reason === DisconnectReason.loggedOut) {
                fs.rmSync(folderPath, { recursive: true, force: true });
                PENDING_SESSIONS.set(sessionName, { message: 'Logged out.' });
            } else startSessionBackend(sessionName);
        }
    });
    sock.ev.on('creds.update', async () => {
        await saveCreds();
        const credsPath = path.join(folderPath, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const content = fs.readFileSync(credsPath, 'utf8');
            const dbKey = sessionName.replace('@s.whatsapp.net', '');
            await saveSessionDataToDB(dbKey, content);
        }
    });
}
initializeDatabase().then(async () => {
    const db = require('./cobudb');
    const allSessions = await db.query(`SELECT whatsapp_number, session_online FROM cobutech`);
    allSessions.rows.forEach(async ({ whatsapp_number, session_online }) => {
        const folder = path.join(sessionsDir, whatsapp_number);
        if (session_online) {
            startSessionBackend(whatsapp_number);
        } else if (!session_online && fs.existsSync(folder)) {
            fs.rmSync(folder, { recursive: true, force: true });
            await markSessionOffline(whatsapp_number);
        }
    });
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
});
