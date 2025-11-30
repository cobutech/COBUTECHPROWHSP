const db = require('./cobudb');

const initializeDatabase = async () => {
    const createCobutechTableQuery = `
        CREATE TABLE IF NOT EXISTS cobutech (
            id SERIAL PRIMARY KEY,
            whatsapp_number TEXT UNIQUE NOT NULL,
            whatsapp_name TEXT,
            session_online BOOLEAN DEFAULT FALSE,
            session_id TEXT,
            bot_name TEXT,
            bot_version TEXT,
            autoread BOOLEAN DEFAULT FALSE,
            autoviewstatus BOOLEAN DEFAULT FALSE,
            autorecordingtyping BOOLEAN DEFAULT FALSE,
            auto_typing BOOLEAN DEFAULT FALSE,
            auto_recording BOOLEAN DEFAULT FALSE,
            mode TEXT DEFAULT 'public',
            prefix TEXT DEFAULT '.',
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

    try {
        await db.query(createCobutechTableQuery);
        await db.query(createBotsTableQuery);
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
    try {
        await db.query(query, [whatsappNumber, whatsappName, sessionId]);
    } catch (error) {
    }
};

const markSessionOffline = async (whatsappNumber) => {
    const query = `
        UPDATE cobutech SET session_online = FALSE, last_updated = CURRENT_TIMESTAMP WHERE whatsapp_number = $1;
    `;
    try {
        await db.query(query, [whatsappNumber]);
    } catch (error) {
    }
};

const checkIfOnline = async (whatsappNumber) => {
    const query = `
        SELECT session_online FROM cobutech WHERE whatsapp_number = $1;
    `;
    try {
        const result = await db.query(query, [whatsappNumber]);
        return result.rows.length > 0 ? result.rows[0].session_online : false;
    } catch (error) {
        return false;
    }
};

const checkUserStatus = async (whatsappNumber) => {
    const query = `
        SELECT * FROM cobutech WHERE whatsapp_number = $1;
    `;
    try {
        const result = await db.query(query, [whatsappNumber]);
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        return null;
    }
};

const getUserSettings = async (whatsappNumber) => {
    const query = `
        SELECT autoread, autoviewstatus, autorecordingtyping, auto_typing, auto_recording, anti_delete, always_online, mode, prefix, sudo_numbers FROM cobutech WHERE whatsapp_number = $1;
    `;
    try {
        const result = await db.query(query, [whatsappNumber]);
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        return null;
    }
};

const getBotSettingsByJid = async (whatsappNumber) => {
    const query = `
        SELECT autoread, autoviewstatus, autorecordingtyping, auto_typing, auto_recording, anti_delete, always_online, mode, prefix, sudo_numbers FROM cobutech WHERE whatsapp_number = $1;
    `;
    try {
        const result = await db.query(query, [whatsappNumber]);
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        return null;
    }
};

const getBotConfig = async (whatsappNumber) => {
    const query = `
        SELECT bot_name, bot_version FROM cobutech WHERE whatsapp_number = $1;
    `;
    try {
        const result = await db.query(query, [whatsappNumber]);
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        return null;
    }
};

const deleteSessionBySessionId = async (sessionId) => {
    const query = `
        DELETE FROM cobutech WHERE session_id = $1;
    `;
    try {
        await db.query(query, [sessionId]);
    } catch (error) {
    }
};

const getAvailableBots = async () => {
    const query = `
        SELECT name, version FROM bots WHERE status = 'completed';
    `;
    try {
        const result = await db.query(query);
        return result.rows;
    } catch (error) {
        return [];
    }
};

const getDeveloperContact = async () => {
    const query = `
        SELECT developer_name, developer_number, channel_link FROM bots LIMIT 1;
    `;
    try {
        const result = await db.query(query);
        return result.rows.length > 0 ? result.rows[0] : { developer_name: 'Unknown', developer_number: 'N/A', channel_link: 'N/A' };
    } catch (error) {
        return { developer_name: 'Unknown', developer_number: 'N/A', channel_link: 'N/A' };
    }
};

const updateUserSettings = async (whatsappNumber, botName, botVersion, autoread, autoviewstatus, autorecordingtyping, autoTyping, autoRecording, antiDelete, alwaysOnline, mode, prefix, sudoNumbers) => {
    const query = `
        UPDATE cobutech
        SET bot_name = $2, bot_version = $3, autoread = $4, autoviewstatus = $5, autorecordingtyping = $6, auto_typing = $7, auto_recording = $8,
            anti_delete = $9, always_online = $10, mode = $11, prefix = $12, sudo_numbers = $13, last_updated = CURRENT_TIMESTAMP
        WHERE whatsapp_number = $1;
    `;
    try {
        await db.query(query, [
            whatsappNumber,
            botName,
            botVersion,
            autoread,
            autoviewstatus,
            autorecordingtyping,
            autoTyping,
            autoRecording,
            antiDelete,
            alwaysOnline,
            mode,
            prefix,
            sudoNumbers
        ]);
    } catch (error) {
    }
};

module.exports = {
    initializeDatabase,
    storeUserData,
    markSessionOffline,
    checkIfOnline,
    checkUserStatus,
    getUserSettings,
    getBotSettingsByJid,
    getBotConfig,
    deleteSessionBySessionId,
    getAvailableBots,
    updateUserSettings,
    getDeveloperContact
};
