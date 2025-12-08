const db = require('./cobudb');

const initializeDatabase = async () => {
    const createCobutechTableQuery = `
        CREATE TABLE IF NOT EXISTS cobutech (
            id SERIAL PRIMARY KEY,
            whatsapp_number TEXT UNIQUE NOT NULL,
            whatsapp_name TEXT,
            session_online BOOLEAN DEFAULT FALSE,
            session_id TEXT,
            session_data TEXT,
            bot_name TEXT,
            bot_version TEXT,
            autoread BOOLEAN DEFAULT FALSE,
            autoviewstatus BOOLEAN DEFAULT FALSE,
            autorecordingtyping BOOLEAN DEFAULT FALSE,
            auto_typing BOOLEAN DEFAULT FALSE,
            auto_recording BOOLEAN DEFAULT FALSE,
            mode TEXT DEFAULT 'public',
            prefix TEXT DEFAULT '',
            sudo_numbers TEXT DEFAULT '',
            anti_delete BOOLEAN DEFAULT FALSE,
            always_online BOOLEAN DEFAULT FALSE,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    const createBotsTableQuery = `
        CREATE TABLE IF NOT EXISTS bots (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            version TEXT NOT NULL,
            developer_name TEXT,
            developer_number TEXT,
            channel_link TEXT,
            status TEXT DEFAULT 'completed'
        );
    `;
    const createTechTableQuery = `
        CREATE TABLE IF NOT EXISTS tech (
            whatsapp_number TEXT PRIMARY KEY,
            bot_name TEXT,
            bot_version TEXT,
            bot_active BOOLEAN DEFAULT true,
            mute_unknown BOOLEAN DEFAULT false,
            anticall_active BOOLEAN DEFAULT false,
            autoreply_active BOOLEAN DEFAULT false,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    try {
        await db.query(createCobutechTableQuery);
        await db.query(createBotsTableQuery);
        await db.query(createTechTableQuery);
    } catch (error) {
        console.error("DB Init Error:", error);
    }
};

const storeUserData = async (whatsappNumber, whatsappName, sessionId) => {
    const query = `
        INSERT INTO cobutech (whatsapp_number, whatsapp_name, session_online, session_id)
        VALUES ($1, $2, TRUE, $3)
        ON CONFLICT (whatsapp_number) DO UPDATE
        SET whatsapp_name = $2, session_online = TRUE, session_id = $3, last_updated = CURRENT_TIMESTAMP;
    `;
    try { await db.query(query, [whatsappNumber, whatsappName, sessionId]); } catch {}
};

const markSessionOffline = async (whatsappNumber) => {
    const query = `UPDATE cobutech SET session_online = FALSE, last_updated = CURRENT_TIMESTAMP WHERE whatsapp_number = $1;`;
    try { await db.query(query, [whatsappNumber]); } catch {}
};

const checkIfOnline = async (whatsappNumber) => {
    const result = await db.query('SELECT session_online FROM cobutech WHERE whatsapp_number = $1;', [whatsappNumber]);
    return result.rows.length ? result.rows[0].session_online : false;
};

const checkUserStatus = async (whatsappNumber) => {
    const result = await db.query('SELECT * FROM cobutech WHERE whatsapp_number = $1;', [whatsappNumber]);
    return result.rows.length ? result.rows[0] : null;
};

const getUserSettings = async (whatsappNumber) => {
    const result = await db.query(`
        SELECT autoread, autoviewstatus, autorecordingtyping, auto_typing, auto_recording,
               anti_delete, always_online, mode, prefix, sudo_numbers
        FROM cobutech WHERE whatsapp_number = $1;
    `, [whatsappNumber]);
    return result.rows.length ? result.rows[0] : null;
};

const getBotSettingsByJid = async (whatsappNumber) => {
    const result = await db.query(`
        SELECT autoread, autoviewstatus, autorecordingtyping, auto_typing, auto_recording,
               anti_delete, always_online, mode, prefix, sudo_numbers
        FROM cobutech WHERE whatsapp_number = $1;
    `, [whatsappNumber]);
    return result.rows.length ? result.rows[0] : null;
};

const getAvailableBots = async () => {
    const result = await db.query(`SELECT name, version FROM bots WHERE status = 'completed';`);
    return result.rows;
};

const getDeveloperContact = async () => {
    const result = await db.query(`SELECT developer_name, developer_number, channel_link FROM bots LIMIT 1;`);
    return result.rows.length ? result.rows[0] : { developer_name: 'Unknown', developer_number: 'N/A', channel_link: 'N/A' };
};

const updateUserSettings = async (whatsappNumber, botName, botVersion, autoread, autoviewstatus, autorecordingtyping,
                                  autoTyping, autoRecording, antiDelete, alwaysOnline, mode, prefix, sudoNumbers) => {
    const query = `
        UPDATE cobutech
        SET bot_name = $2, bot_version = $3, autoread = $4, autoviewstatus = $5, autorecordingtyping = $6,
            auto_typing = $7, auto_recording = $8, anti_delete = $9, always_online = $10, mode = $11,
            prefix = $12, sudo_numbers = $13, last_updated = CURRENT_TIMESTAMP
        WHERE whatsapp_number = $1;
    `;
    try {
        await db.query(query, [whatsappNumber, botName, botVersion, autoread, autoviewstatus, autorecordingtyping,
                               autoTyping, autoRecording, antiDelete, alwaysOnline, mode, prefix, sudoNumbers]);
    } catch {}
};

const getTechSettings = async (whatsappNumber) => {
    const r = await db.query('SELECT * FROM tech WHERE whatsapp_number = $1;', [whatsappNumber]);
    return r.rows.length ? r.rows[0] : null;
};

const updateTechSettings = async (whatsappNumber, fields) => {
    const keys   = Object.keys(fields);
    const set    = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const vals   = Object.values(fields);
    const sql = `INSERT INTO tech (whatsapp_number, ${keys.join(', ')})
                 VALUES ($1, ${vals.map((_, i) => `$${i + 2}`).join(', ')})
                 ON CONFLICT (whatsapp_number) DO UPDATE SET ${set}, last_updated = CURRENT_TIMESTAMP;`;
    await db.query(sql, [whatsappNumber, ...vals]);
};

const saveSessionDataToDB = async (whatsappNumber, sessionJsonData) => {
    const query = `
        UPDATE cobutech 
        SET session_data = $2, last_updated = CURRENT_TIMESTAMP 
        WHERE whatsapp_number = $1;
    `;
    try { await db.query(query, [whatsappNumber, sessionJsonData]); } catch (e) { console.error("Save Creds Error", e); }
};

const getSessionDataFromDB = async (whatsappNumber) => {
    const result = await db.query('SELECT session_data FROM cobutech WHERE whatsapp_number = $1;', [whatsappNumber]);
    return result.rows.length && result.rows[0].session_data ? result.rows[0].session_data : null;
};

module.exports = {
    initializeDatabase,
    storeUserData,
    markSessionOffline,
    checkIfOnline,
    checkUserStatus,
    getUserSettings,
    getBotSettingsByJid,
    getAvailableBots,
    updateUserSettings,
    getDeveloperContact,
    getTechSettings,
    updateTechSettings,
    saveSessionDataToDB,
    getSessionDataFromDB
};
