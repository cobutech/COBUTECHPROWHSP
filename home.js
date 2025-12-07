// connection.js
// Updated: Render-friendly, fixes session persistence, QR + pairing handling, reconnection, and cleans duplicated code.

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
  checkIfOnline
} = require('./cobudbupdt');

const { startBotLogic } = require('./cobusts');

dotenv.config();

// ---------- Configuration ----------
const DEFAULT_LOCAL_SESSIONS = path.join(__dirname, 'sessions'); // local fallback
const SESSIONS_DIR = process.env.SESSIONS_DIR || DEFAULT_LOCAL_SESSIONS;
const PORT = process.env.PORT || 5000;
const ACTIVE_SESSIONS = new Map(); // sessionName => sock
const PENDING_SESSIONS = new Map(); // sessionName => { qr, code, message }

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// ---------- Helpers ----------
/**
 * Accepts a phone string and returns normalized JID (digits + @s.whatsapp.net)
 * Accepts already normalized strings too.
 */
const normalizeNumber = (n) => {
  if (!n) return null;
  // If it's an object (from form) coerce to string
  const s = String(n);
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return null;
  return digits.endsWith('@s.whatsapp.net') ? digits : `${digits}@s.whatsapp.net`;
};

/**
 * Digits-only phone (no jid) for requestPairingCode if needed
 */
const digitsOnly = (n) => {
  if (!n) return null;
  return String(n).replace(/[^0-9]/g, '');
};

// ---------- Express setup ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
app.get('/setup', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Check if a session folder exists or is active
app.post('/api/check-session', async (req, res) => {
  const { sessionName } = req.body;
  if (!sessionName) return res.json({ success: false, message: 'Session name required' });

  const folderPath = path.join(SESSIONS_DIR, sessionName);
  if (ACTIVE_SESSIONS.has(sessionName)) return res.json({ status: 'active', message: 'Session is already active.' });
  if (fs.existsSync(folderPath)) {
    // try reconnecting (non-blocking)
    startSessionBackend(sessionName).catch((e) => console.error('reconnect error', e));
    return res.json({ status: 'reconnecting', message: 'Session found. Reconnecting...' });
  }
  return res.json({ status: 'new', message: 'Session not found. Create new.' });
});

// Start/init a session: method: 'qr' or 'pairing'
app.post('/api/init-session', async (req, res) => {
  const { sessionName, method, phoneNumber } = req.body;
  // launch in background
  startSessionBackend(sessionName, true, method, phoneNumber).catch((e) => console.error('init-session error', e));
  res.json({ success: true, message: 'Initialization started' });
});

// Poll session state for frontend
app.get('/api/session-poll', (req, res) => {
  const sessionName = req.query.sessionName;
  if (!sessionName) return res.json({ success: false, message: 'sessionName query required' });

  if (ACTIVE_SESSIONS.has(sessionName)) return res.json({ status: 'connected' });

  const pending = PENDING_SESSIONS.get(sessionName);
  if (pending) return res.json({ status: 'pending', qr: pending.qr, code: pending.code, message: pending.message });

  return res.json({ status: 'waiting' });
});

// Bot selection endpoints (kept as originally)
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

// Submit settings form (kept intact)
app.post('/submit', async (req, res) => {
  const { number, botName, botVersion, userName, autoread, autoviewstatus, autorecordingtyping, autoTyping, autoRecording, antiDelete, alwaysOnline, mode, prefix, sudo1, sudo2, sudo3 } = req.body;
  const finalPrefix = (prefix || '').trim();
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
𝑷𝑳𝑬𝑨𝑺𝑬 𝑼𝑺𝑬  ${fullBotName}  𝑾𝑰𝑻𝑯 𝑪𝑨𝑹𝑬 𝑻𝑶 𝑨𝑽𝑶𝑰𝑫 𝑨𝑪𝑪𝑶𝑼𝑵𝑻 𝑩𝑨𝑵 𝑭𝑶𝑹𝑴 𝑻𝐇𝐄  𝑪𝑶𝐵𝐔𝐓𝐄𝐂𝐻𝐈𝐍𝐃𝐔𝐒𝐓𝐑𝒀 𝑪𝑶𝑴𝑴𝑼𝑵𝑰𝒀
═════════════════════════════
𝑯𝑨𝑽𝑰𝑵𝑮 𝑰𝑺𝑺𝑼𝑬𝑺 𝑫𝑶𝑵'𝑻 𝑯𝐄𝐒𝐈𝐓𝐀𝐓𝐄 𝑻𝑶 𝑪𝑶𝑵𝑻𝐀𝐂𝐓  ${devContact.developer_name} 𝑻𝐇𝐑𝐎𝐔𝐆𝐇  ${devContact.developer_number}
═════════════════════════════
𝑭𝑶𝐋𝐋𝐎𝑾 𝑴𝒀 𝑪𝐇𝐀𝐍𝐍𝐄𝐋 𝑭𝑶𝑹 𝑴𝑶𝑹𝐄 𝑼𝑷𝐃𝐀𝐓𝐄𝐒 :${devContact.channel_link}
> 𝑻𝐇𝐄 𝑷𝑶𝑾𝐸𝑹 𝑶𝐅 ${fullBotName}
═════════════════════════════`.trim();

    try {
      if (fs.existsSync('techmain.jpg')) {
        await activeSock.sendMessage(userJid, {
          image: fs.readFileSync('techmain.jpg'),
          caption: messageText,
          contextInfo: { externalAdReply: { sourceUrl: devContact.channel_link, title: "𝑪𝑶𝑩𝑼𝑻𝑬𝑪𝑯𝑰𝑵𝑫𝑼𝑺𝑻𝑹𝒀🌐", body: "" } }
        });
      } else {
        await activeSock.sendMessage(userJid, { text: messageText });
      }
    } catch (e) {
      console.error('send welcome after submit error', e);
    }
  }

  res.json({ success: true, page: 'finish', botName, userName });
});

// ---------- Baileys session & socket management ----------
async function startSessionBackend(sessionName, isNew = false, method = null, phoneNumber = null) {
  const folderPath = path.join(SESSIONS_DIR, sessionName);
  PENDING_SESSIONS.set(sessionName, { qr: null, code: null, message: 'Starting...' });

  try {
    // ensure session folder exists
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

    // load auth state
    const { state, saveCreds } = await useMultiFileAuthState(folderPath);

    // get latest baileys version
    const { version } = await fetchLatestBaileysVersion();

    const logger = P({ level: 'silent' });
    const sock = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      printQRInTerminal: false,
      logger,
      browser: Browsers.ubuntu('Chrome'),
      version,
      connectTimeoutMs: 60000
    });

    // If new & pairing requested, request pairing code after socket initialized
    if (isNew && method === 'pairing') {
      setTimeout(async () => {
        try {
          // requestPairingCode sometimes expects digits-only number
          const num = digitsOnly(phoneNumber) || phoneNumber;
          if (!num) {
            PENDING_SESSIONS.set(sessionName, { message: 'Phone number missing for pairing' });
            return;
          }
          const code = await sock.requestPairingCode(num);
          PENDING_SESSIONS.set(sessionName, { code, message: 'Code Generated' });
        } catch (err) {
          console.error('pairing code error', err);
          PENDING_SESSIONS.set(sessionName, { message: 'Error generating code' });
        }
      }, 1200);
    }

    // Connection update handling
    sock.ev.on('connection.update', async (update) => {
      try {
        const { qr, connection, lastDisconnect } = update;

        // QR flow: when new and requesting QR, convert QR to data URL and put into pending map
        if (qr && isNew && method === 'qr') {
          try {
            const qrUrl = await QRCode.toDataURL(qr);
            PENDING_SESSIONS.set(sessionName, { qr: qrUrl, message: 'Scan QR' });
          } catch (err) {
            console.error('qr generation error', err);
            PENDING_SESSIONS.set(sessionName, { message: 'Error generating QR' });
          }
        }

        // When connection opens (success)
        if (connection === 'open') {
          const rawId = sock.user?.id;
          const userJid = rawId ? jidNormalizedUser(rawId) : sessionName;
          const userName = sock.user?.name || sock.user?.notify || sessionName;

          // mark active and remove pending
          ACTIVE_SESSIONS.set(sessionName, sock);
          PENDING_SESSIONS.delete(sessionName);

          try {
            await storeUserData(userJid, userName, sessionName);
          } catch (err) {
            console.error('storeUserData error', err);
          }

          try {
            // start your bot logic (existing)
            await startBotLogic(sock, userJid, getBotSettingsByJid, getDeveloperContact);
          } catch (err) {
            console.error('startBotLogic error', err);
          }

          // send welcome and other post-open jobs
          try {
            const devContact = await getDeveloperContact();
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
       ═𝐄𝑁𝐉𝑂𝑌 𝑰𝑻'𝑺 𝑷𝑶𝑾𝐄𝑹 𝑶𝐅◇══`.trim();
            } else {
              const botSettings = await getBotSettingsByJid(userJid);
              fullBotName = `${botSettings.bot_name || 'Unknown'} V-${botSettings.bot_version || '0.0'}`;
              welcomeMsg = `
♥︎✦♥︎✦♥︎𝑾𝑬𝑳𝑪𝑶𝑴𝑬 𝑩𝑨𝑪𝑲♥︎✦♥︎✦♥︎
◇══◇ ${userName} ◇══◇
                      𝒀𝑶𝑼𝑹
◇══◇${sessionName}◇══◇
𝑩𝑬𝑬𝑵  𝑺𝑼𝑪𝑪𝑬𝑺𝑺𝑭𝑼𝒀 𝑹𝑬𝑪𝑶𝑵𝑵𝑬𝑪𝑻𝑬𝑫`.trim();
            }

            try {
              if (fs.existsSync('techmain.jpg')) {
                await sock.sendMessage(userJid, {
                  image: fs.readFileSync('techmain.jpg'),
                  caption: welcomeMsg,
                  contextInfo: { externalAdReply: { sourceUrl: devContact.channel_link, title: "𝑪𝑶𝑩𝑼𝑻𝑬𝑪𝑯𝑰𝑵𝑫𝑼𝑺𝑻𝑹𝒀🌐", body: "" } }
                });
              } else {
                await sock.sendMessage(userJid, { text: welcomeMsg });
              }
            } catch (e) {
              console.error('welcome message error', e);
            }

            if (!userStatus.bot_name || !userStatus.bot_version) {
              const noBotText = `
𝑫𝑬𝑨𝑹 ${userName}, 𝑻𝑯𝑬 𝑺𝑬𝑺𝑺𝑰𝑶𝑵 ${sessionName} 𝑯𝑨𝑺 𝑵𝑶 𝑨𝑪𝑻𝑰𝑽𝑬 𝑩𝑶𝑻.
𝑪𝑶𝑵𝑻𝑨𝑪𝑻 ${devContact.developer_name} 𝑻𝑯𝑹𝑶𝑼𝑮𝐻 ${devContact.developer_number}
𝑭𝑶𝑳𝑳𝑶𝑾 𝑼𝑷𝑫𝑨𝑻𝑬𝑺: ${devContact.channel_link}
> 𝑻𝑯𝑬 𝑷𝑶𝑾𝑬𝑹 𝑶𝑭 𝑻𝑬𝑪𝑯 𝑰𝑵𝑫𝑼𝑺𝑻𝑹𝒀`.trim();
              try { await sock.sendMessage(userJid, { text: noBotText }); } catch (e) { /* ignore */ }
            }
          } catch (err) {
            console.error('post-open tasks error', err);
          }
        }

        // On connection close, handle logout vs transient disconnect
        if (connection === 'close') {
          ACTIVE_SESSIONS.delete(sessionName);

          const reason = lastDisconnect?.error?.output?.statusCode;
          try {
            if (sock.user?.id) await markSessionOffline(jidNormalizedUser(sock.user.id));
          } catch (e) { /* ignore */ }

          if (reason === DisconnectReason.loggedOut) {
            // permanent logout - remove session folder
            try {
              fs.rmSync(folderPath, { recursive: true, force: true });
            } catch (e) { /* ignore */ }
            PENDING_SESSIONS.set(sessionName, { message: 'Logged out.' });
          } else {
            console.warn(`Connection closed for ${sessionName}. Reason: ${reason}. Reconnecting...`);
            // attempt reconnect after delay (non-blocking)
            setTimeout(() => startSessionBackend(sessionName).catch(e => console.error('reconnect attempt failed', e)), 3000);
          }
        }
      } catch (e) {
        console.error('connection.update handler error', e);
      }
    });

    // Persist credentials on changes
    sock.ev.on('creds.update', saveCreds);

    // Save socket immediately so other code can reference it (active only confirmed on 'open')
    // This also helps graceful shutdown handlers reference the socket
    ACTIVE_SESSIONS.set(sessionName, sock);

    // Error logging
    sock.ev.on('connection.error', (err) => {
      console.error('socket connection.error', err);
    });

    // Graceful shutdown handlers (important on Render)
    const shutdown = async () => {
      try { await sock.logout?.(); } catch (err) { /* ignore */ }
      try { process.exit(0); } catch (e) { /* ignore */ }
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

  } catch (err) {
    console.error(`startSessionBackend(${sessionName}) error:`, err);
    PENDING_SESSIONS.set(sessionName, { message: 'Failed to start session.' });
  }
}

// ---------- DB init & auto-start any sessions marked online ----------
initializeDatabase().then(async () => {
  try {
    const db = require('./cobudb');
    const allSessions = await db.query(`SELECT whatsapp_number, session_online FROM cobutech`);
    // For each session row, if session_online and a folder exists, try reconnect
    for (const row of allSessions.rows) {
      const { whatsapp_number, session_online } = row;
      const folder = path.join(SESSIONS_DIR, whatsapp_number);
      if (session_online && fs.existsSync(folder)) {
        startSessionBackend(whatsapp_number).catch((e) => console.error('auto-start session error', e));
      } else if (!session_online && fs.existsSync(folder)) {
        // cleanup stale folders
        try {
          fs.rmSync(folder, { recursive: true, force: true });
        } catch (e) { /* ignore */ }
        try { await markSessionOffline(whatsapp_number); } catch (err) { /* ignore */ }
      }
    }
  } catch (err) {
    console.error('initializeDatabase post-setup error', err);
  }

  // Start express server
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}).catch(err => {
  console.error('Failed to initialize database', err);
  // Still start server so you can see logs / debug endpoints
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
});
