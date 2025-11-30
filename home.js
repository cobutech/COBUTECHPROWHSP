const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    delay
} = require('@whiskeysockets/baileys');
const P = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

// Import Database Functions
const {
    initializeDatabase,
    storeUserData,
    markSessionOffline,
    checkUserStatus,
    getUserSettings,
    getBotSettingsByJid,
    getAvailableBots,
    updateUserSettings,
    getDeveloperContact
} = require('./cobudbupdt');

const { startBotLogic } = require('./cobusts');

const sessionsDir = './sessions';
const PORT = process.env.PORT || 5000;

// State Management
const ACTIVE_SESSIONS = new Map();
const PENDING_SESSIONS = new Map(); // Stores QR/Pairing codes for frontend

if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir);
}

const normalizeNumber = (number) => {
    const cleanedNumber = number.replace(/[^0-9]/g, '');
    if (!cleanedNumber) return null;
    return cleanedNumber.endsWith('@s.whatsapp.net') ? cleanedNumber : `${cleanedNumber}@s.whatsapp.net`;
};

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/')));

// --- ROUTES ---

// 1. Serve Pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'home.html')); // Connection Page
});

app.get('/setup', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); // Settings Page
});

// 2. Session Check API
app.post('/api/check-session', async (req, res) => {
    const { sessionName } = req.body;
    if (!sessionName) return res.json({ success: false, message: 'Session name required' });

    const folderPath = path.join(sessionsDir, sessionName);
    
    // Case A: Active in Memory
    if (ACTIVE_SESSIONS.has(sessionName)) {
        return res.json({ status: 'active', message: 'Session is already active.' });
    }

    // Case B: Folder exists (Offline/Reconnecting)
    if (fs.existsSync(folderPath)) {
        startSessionBackend(sessionName); // Trigger background reconnect
        return res.json({ status: 'reconnecting', message: 'Session found. Reconnecting...' });
    }

    // Case C: New
    return res.json({ status: 'new', message: 'Session not found. Create new.' });
});

// 3. Initialize Session API
app.post('/api/init-session', async (req, res) => {
    const { sessionName, method, phoneNumber } = req.body;
    startSessionBackend(sessionName, true, method, phoneNumber);
    res.json({ success: true, message: 'Initialization started' });
});

// 4. Poll Status API
app.get('/api/session-poll', (req, res) => {
    const sessionName = req.query.sessionName;
    
    if (ACTIVE_SESSIONS.has(sessionName)) {
        return res.json({ status: 'connected' });
    }

    const pending = PENDING_SESSIONS.get(sessionName);
    if (pending) {
        return res.json({ 
            status: 'pending',
            qr: pending.qr,
            code: pending.code,
            message: pending.message
        });
    }

    res.json({ status: 'waiting' });
});

// 5. Bot Selection & Verification API (For index.html)
app.post('/select-bot', async (req, res) => {
    const { number } = req.body;
    if (!number) return res.json({ success: false, message: 'Please provide a valid WhatsApp number.' });

    const userJid = normalizeNumber(number);
    const userStatus = await checkUserStatus(userJid);

    if (userStatus && userStatus.session_online) {
        if (userStatus.bot_name && userStatus.bot_version) {
            const settings = await getUserSettings(userJid);
            return res.json({
                success: true,
                page: 'settings-bypass',
                number: number,
                userName: userStatus.whatsapp_name,
                settings: settings
            });
        } else {
            const bots = await getAvailableBots(); // This now filters for 'completed'
            if (bots.length === 0) {
                 return res.json({ success: false, message: 'No active bots available at the moment.' });
            }
            return res.json({ success: true, page: 'bot-selection', number: number, bots: bots, userName: userStatus.whatsapp_name });
        }
    } else if (userStatus) {
        return res.json({ success: false, message: `User ${userStatus.whatsapp_name} is found but OFFLINE. Please connect on the Home page first.` });
    } else {
        return res.json({ success: false, message: 'User not found. Please connect your session first.' });
    }
});

// 6. Submit Settings API
app.post('/submit', async (req, res) => {
    const {
        number, botName, botVersion, userName,
        autoread, autoviewstatus, autorecordingtyping,
        autoTyping, autoRecording, antiDelete,
        alwaysOnline,
        mode, prefix, sudo1, sudo2, sudo3
    } = req.body;

    const finalPrefix = prefix.trim() || '.';
    const devContact = await getDeveloperContact();
    const CHANNEL_LINK = devContact.channel_link;
    const DEV_NAME = devContact.developer_name;
    const DEV_NUMBER = devContact.developer_number;

    const userJid = normalizeNumber(number);
    
    // Process Sudo Numbers
    const finalSudoJIDs = new Set();
    const devJid = normalizeNumber(DEV_NUMBER);
    if(devJid) finalSudoJIDs.add(devJid);

    [sudo1, sudo2, sudo3].forEach(num => {
        const n = normalizeNumber(num);
        if (n) finalSudoJIDs.add(n);
    });

    await updateUserSettings(
        userJid, botName, botVersion,
        autoread === 'true', autoviewstatus === 'true', autorecordingtyping === 'true',
        autoTyping === 'true', autoRecording === 'true', antiDelete === 'true',
        alwaysOnline === 'true', mode, finalPrefix, Array.from(finalSudoJIDs).join(',')
    );

    // Send Final Confirmation Message
    const userStatus = await checkUserStatus(userJid);
    const sessionId = userStatus ? userStatus.session_id : null;
    const activeSock = sessionId ? ACTIVE_SESSIONS.get(sessionId) : null;

    if (activeSock) {
        const fullBotName = `${botName} V-${botVersion}`;
        const messageText = `
═════════════════════════════
     ═◇ 𝑺𝑼𝑪𝑪𝑬𝑺𝑺𝑭𝑼𝑳𝑳𝒀 𝑪𝑶𝑵𝑬𝑪𝑻𝑬𝑫  ◇═
═════════════════════════════
                                 ◇ 𝑻𝑶 ◇
═════════════════════════════
 ♥︎✦♥︎ ═══♤♡${fullBotName}♤♡═══♥︎✦♥︎
═════════════════════════════
𝑷𝑳𝑬𝑨𝑺𝑬 𝑼𝑺𝑬 ${fullBotName} 𝑾𝑰𝑻𝑯 𝑪𝑨𝑹𝑬 𝑻𝑶 𝑨𝑽𝑶𝑰𝑫 𝑨𝑪𝑪𝑶𝑼𝑵𝑻 𝑩𝑨𝑵 𝑭𝑶𝑴 𝑻𝑯𝑬  𝑾𝑯𝑨𝑻𝑺𝑨𝑷𝑷 𝑪𝑶𝑴𝑴𝑼𝑵𝑰𝑻𝒀
═════════════════════════════
𝑯𝑨𝑽𝑰𝑵𝑮 𝑰𝑺𝑺𝑼𝑬𝑺 𝑫𝑶𝑵'𝑻 𝑯𝑬𝑺𝑰𝑻𝑨𝑻𝑬 𝑻𝑶 𝑪𝑶𝑵𝑻𝑨𝑪𝑻:${DEV_NAME} 𝑻𝑯𝑹𝑶𝑼𝑮𝑯 :${DEV_NUMBER}
═════════════════════════════
𝑭𝑶𝑳𝑳𝑶𝑾 𝑴𝒀 𝑪𝑯𝑨𝑵𝑵𝑬𝑳 𝑭𝑶𝑹 𝑴𝑶𝑹𝑬 𝑼𝑷𝑫𝑨𝑻𝑬𝑺 :${CHANNEL_LINK}
🗿🗿🗿🗿🗿🗿🗿🗿🗿🗿🗿🗿
> 𝑻𝑯𝑬 𝑷𝑶𝑾𝑬𝑹 𝑶𝑭 ${fullBotName}
═════════════════════════════
`.trim();

        try {
            if (fs.existsSync('techmain.jpg')) {
                await activeSock.sendMessage(userJid, {
                    image: fs.readFileSync('techmain.jpg'),
                    caption: messageText,
                    contextInfo: {
                        externalAdReply: { sourceUrl: CHANNEL_LINK, renderLargerThumbnail: true, showAdAttribution: true }
                    }
                });
            } else {
                await activeSock.sendMessage(userJid, { text: messageText });
            }
        } catch (error) {}
    }

    return res.json({ success: true, page: 'finish', botName: botName, userName: userName });
});

// --- CORE LOGIC ---

async function startSessionBackend(sessionName, isNew = false, method = null, phoneNumber = null) {
    const folderPath = path.join(sessionsDir, sessionName);
    PENDING_SESSIONS.set(sessionName, { qr: null, code: null, message: 'Starting...' });

    let { state, saveCreds } = await useMultiFileAuthState(folderPath);
    const { version } = await fetchLatestBaileysVersion();
    const logger = P({ level: 'silent' });

    const sock = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
        printQRInTerminal: false,
        logger: logger,
        browser: Browsers.ubuntu('Chrome'),
        version,
        connectTimeoutMs: 60000,
    });

    // Pairing Logic
    if (isNew && method === 'pairing' && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                PENDING_SESSIONS.set(sessionName, { code: code, message: 'Code Generated' });
            } catch (err) {
                PENDING_SESSIONS.set(sessionName, { message: 'Error generating code' });
            }
        }, 3000);
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

            // 1. Update DB
            await storeUserData(userJid, userName, sessionName);
            const devContact = await getDeveloperContact();

            // 2. Start Bot Logic
            await startBotLogic(sock, userJid, getBotSettingsByJid, getDeveloperContact);

            // 3. SEND WELCOME MESSAGE (Restored from Original)
            const welcomeMsg = `╔════◇𝑾𝑬𝑳𝑶𝑶𝑴𝑬}◇═══◇

   ◇══◇ { ${userName} }═══◇

                       ◇  𝑻𝑶 ◇
       🤖 𝑪𝑶𝑩𝑼-𝑻𝑬𝑪𝑯-𝑰𝑵𝑫𝑼𝑺𝑻𝑹𝒀 🤖
        ═𝐸𝑵𝐽𝑂𝑌 𝑰𝑻'𝑺 𝑃𝑂𝑊𝐸𝑅 𝑂𝑭◇══`;

            const footerText = '𝑺𝑬𝑵𝑻 𝑩𝒀 @ 𝑻𝑬𝑪𝑯𝑰𝑵𝑫𝑼𝑺𝑻𝑹𝒀';

            try {
                if (fs.existsSync('cobutech.jpg')) {
                    await sock.sendMessage(userJid, {
                        image: fs.readFileSync('cobutech.jpg'),
                        caption: welcomeMsg,
                        contextInfo: {
                            isForwarded: true,
                            forwardingScore: 500,
                            externalAdReply: {
                                sourceUrl: devContact.channel_link,
                                renderLargerThumbnail: true,
                                showAdAttribution: true
                            },
                            footer: footerText
                        }
                    });
                } else {
                    await sock.sendMessage(userJid, { text: welcomeMsg });
                }
            } catch (e) {
                console.error("Error sending welcome message:", e);
            }
        }

        if (connection === 'close') {
            ACTIVE_SESSIONS.delete(sessionName);
            const reason = lastDisconnect?.error?.output?.statusCode;

            if (sock.user?.id) {
                await markSessionOffline(jidNormalizedUser(sock.user.id));
            }

            if (reason === DisconnectReason.loggedOut) {
                fs.rmSync(folderPath, { recursive: true, force: true });
                PENDING_SESSIONS.set(sessionName, { message: 'Logged out.' });
            } else {
                startSessionBackend(sessionName); // Reconnect
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

initializeDatabase().then(() => {
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
});