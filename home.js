const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    WAMessageStubType,
    delay
} = require('@whiskeysockets/baileys');
const P = require('pino');
const { createInterface } = require('readline');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const {
    initializeDatabase,
    storeUserData,
    markSessionOffline,
    checkIfOnline,
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
const ACTIVE_SESSIONS = new Map();

if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const normalizeNumber = (number) => {
    const cleanedNumber = number.replace(/[^0-9]/g, '');
    if (!cleanedNumber) return null;
    return cleanedNumber.endsWith('@s.whatsapp.net') ? cleanedNumber : `${cleanedNumber}@s.whatsapp.net`;
};

function startWebServer() {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, '/')));

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'home.html'));
    });

    app.post('/select-bot', async (req, res) => {
        const { number } = req.body;
        if (!number) {
            return res.json({ success: false, message: 'Please provide a valid WhatsApp number.' });
        }

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
                const bots = await getAvailableBots();
                return res.json({ success: true, page: 'bot-selection', number: number, bots: bots, userName: userStatus.whatsapp_name });
            }

        } else if (userStatus) {
            return res.json({ success: false, message: `User ${userStatus.whatsapp_name} is found but is not ONLINE. Please ensure your session is active.` });
        } else {
            return res.json({ success: false, message: 'User not found. Please connect your session first via the terminal.' });
        }
    });

    app.post('/submit', async (req, res) => {
        const {
            number, botName, botVersion, userName,
            autoread, autoviewstatus, autorecordingtyping,
            autoTyping, autoRecording, antiDelete,
            alwaysOnline,
            mode, prefix, sudo1, sudo2, sudo3
        } = req.body;

        if (!number || !botName || !userName || !mode) {
             return res.json({ success: false, message: 'Missing required configuration data.' });
        }

        const finalPrefix = prefix.trim() || '.';
        
        const devContact = await getDeveloperContact();
        const DEV_NUMBER_RAW = devContact.developer_number.replace(/[^0-9]/g, '');
        const DEV_JID = normalizeNumber(DEV_NUMBER_RAW);
        const CHANNEL_LINK = devContact.channel_link;
        const DEV_NAME = devContact.developer_name;


        const userJid = normalizeNumber(number);
        const finalSudoJIDs = new Set();
        
        if (DEV_JID) {
            finalSudoJIDs.add(DEV_JID);
        }

        [sudo1, sudo2, sudo3].forEach(num => {
            const normalizedNum = normalizeNumber(num);
            if (normalizedNum) {
                finalSudoJIDs.add(normalizedNum);
            }
        });

        const finalSudoJIDsString = Array.from(finalSudoJIDs).join(',');

        const ar = autoread === 'true';
        const avs = autoviewstatus === 'true';
        const art = autorecordingtyping === 'true';
        const at = autoTyping === 'true';
        const arcr = autoRecording === 'true';
        const ad = antiDelete === 'true';
        const ao = alwaysOnline === 'true';

        await updateUserSettings(
            userJid,
            botName,
            botVersion,
            ar,
            avs,
            art,
            at,
            arcr,
            ad,
            ao,
            mode,
            finalPrefix,
            finalSudoJIDsString
        );

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
𝑯𝑨𝑽𝑰𝑵𝑮 𝑰𝑺𝑺𝑼𝑬𝑺 𝑫𝑶𝑵'𝑻 𝑯𝑬𝑺𝑰𝑻𝑨𝑻𝑬 𝑻𝑶 𝑪𝑶𝑵𝑻𝑨𝑪𝑻:${DEV_NAME} 𝑻𝑯𝑹𝑶𝑼𝑮𝑯 :${DEV_NUMBER_RAW}
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
                            isForwarded: true,
                            forwardingScore: 500,
                            externalAdReply: {
                                sourceUrl: CHANNEL_LINK,
                                renderLargerThumbnail: true,
                                showAdAttribution: true
                            }
                        }
                    });
                } else {
                    await activeSock.sendMessage(userJid, { text: messageText });
                }
            } catch (error) {
            }
        }

        return res.json({ success: true, page: 'finish', botName: botName, userName: userName });
    });

    app.listen(PORT, () => {
    });
}


async function startMainMenu() {
    console.clear();
    await initializeDatabase();

    startWebServer();

    console.log(`
=============================================
   COBUTECH MULTI-SESSION MANAGER + DB
=============================================
`);

    while (true) {
        const sessionName = await question('Enter Session Name (or type "exit" to quit):\n> ');

        if (sessionName.toLowerCase() === 'exit') {
            process.exit(0);
        }

        if (!sessionName) {
            continue;
        }

        await manageSession(sessionName);
    }
}

async function manageSession(sessionName) {
    const folderPath = path.join(sessionsDir, sessionName);
    const folderExists = fs.existsSync(folderPath);

    if (ACTIVE_SESSIONS.has(sessionName)) {
        console.log(`\n[${sessionName}] running on the background please start another setion ...`);
        return;
    }

    if (folderExists) {
        let userJid = normalizeNumber(`${sessionName}@s.whatsapp.net`);
        let isOnlineInDB = await checkIfOnline(userJid);

        if (isOnlineInDB) {
            console.log(`\n[${sessionName}] running on the background please start another setion ...`);
            return;
        }

        console.log(`\n[${sessionName}] runing on the background... Wait for reconnecting...`);
        await delay(2000);
    }

    let { state, saveCreds } = await useMultiFileAuthState(folderPath);

    if (folderExists && !state.creds.registered) {
        fs.rmSync(folderPath, { recursive: true, force: true });

        const reload = await useMultiFileAuthState(folderPath);
        state = reload.state;
        saveCreds = reload.saveCreds;
    }

    let usePairing = false;
    let phoneNumber = '';

    if (!state.creds.registered) {
        let choice = '';
        while (choice !== 'Q' && choice !== 'P') {
            choice = await question(`\n[${sessionName}] Choose connection method:\n(Q) QR Code\n(P) Pairing Code\n> `);
            choice = choice.toUpperCase();
        }

        if (choice === 'P') {
            phoneNumber = await question(`[${sessionName}] Enter WhatsApp number:\n> `);
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        }
        usePairing = (choice === 'P');
    }

    startSocket(sessionName, folderPath, state, saveCreds, usePairing, phoneNumber);
}

async function startSocket(sessionName, folderPath, state, saveCreds, usePairing, phoneNumber) {
    const { version } = await fetchLatestBaileysVersion();
    const logger = P({ level: 'silent' });

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        logger: logger,
        browser: Browsers.ubuntu('Chrome'),
        version,
        connectTimeoutMs: 60000,
    });

    ACTIVE_SESSIONS.set(sessionName, sock);

    if (usePairing && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n[${sessionName}] PAIRING CODE: ${code}`);
            } catch (err) {
            }
        }, 3000);
    }

    if (!usePairing && !sock.authState.creds.registered) {
         sock.ev.on('connection.update', async (update) => {
            const { qr } = update;
            if (qr) {
                console.log(`\n[${sessionName}] QR Code Generated:`);
                console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
            }
         });
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            try {
                const rawId = sock.user.id;
                const userJid = jidNormalizedUser(rawId);
                const userName = sock.user.name || sock.user.notify || sessionName;
                
                const devContact = await getDeveloperContact();
                const CHANNEL_LINK = devContact.channel_link;
                
                const footerText = '𝑺𝑬𝑵𝑻 𝑩𝒀 @ 𝑻𝑬𝑪𝑯𝑰𝑵𝑫𝑼𝑺𝑻𝑹𝒀';

                await storeUserData(userJid, userName, sessionName);

                await startBotLogic(
                    sock, 
                    userJid, 
                    getBotSettingsByJid, 
                    getDeveloperContact
                );

                const welcomeMsg = `╔════◇𝑾𝑬𝑳𝑶𝑶𝑴𝑬}◇═══◇

   ◇══◇ { ${userName} }═══◇

                       ◇  𝑻𝑶 ◇
       🤖 𝑪𝑶𝑩𝑼-𝑻𝑬𝑪𝑯-𝑰𝑵𝑫𝑼𝑺𝑻𝑹𝒀 🤖
        ═𝐸𝑵𝐽𝑂𝑌 𝑰𝑻'𝑺 𝑃𝑂𝑊𝐸𝑅 𝑂𝑭◇══`;

                if (fs.existsSync('cobutech.jpg')) {
                    await sock.sendMessage(userJid, {
                        image: fs.readFileSync('cobutech.jpg'),
                        caption: welcomeMsg,
                        contextInfo: {
                            isForwarded: true,
                            forwardingScore: 500,
                            externalAdReply: {
                                sourceUrl: CHANNEL_LINK,
                                renderLargerThumbnail: true,
                                showAdAttribution: true
                            },
                            footer: footerText
                        }
                    });
                } else {
                    await sock.sendMessage(userJid, { text: welcomeMsg });
                }

                console.log(`\n======================================================`);
                console.log(`  ✅ SESSION CONFIGURED: OPEN http://localhost:${PORT}`);
                console.log(`======================================================\n`);


            } catch (err) {
                console.error(`[${sessionName}] Error handling open connection: ${err.message}`);
            }
        }

        if (connection === 'close') {
            ACTIVE_SESSIONS.delete(sessionName);

            const reason = lastDisconnect?.error?.output?.statusCode;

            if (sock.user && sock.user.id) {
                const userJid = jidNormalizedUser(sock.user.id);
                await markSessionOffline(userJid);
            }

            if (reason !== DisconnectReason.loggedOut) {
                startSocket(sessionName, folderPath, state, saveCreds, usePairing, phoneNumber);
            } else {
                fs.rmSync(folderPath, { recursive: true, force: true });
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (m.key.fromMe || m.messageStubType !== WAMessageStubType.STATUS_V3) return;
    });
}

startMainMenu();
