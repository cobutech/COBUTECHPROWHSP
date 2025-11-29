import { query } from './cobudb.js';
import { generatePairingCode, startBotSession } from './cobupr.js'; 

const SERIAL_TRACKER_SQL = `
    CREATE TABLE IF NOT EXISTS serial_tracker (
        name VARCHAR(50) PRIMARY KEY,
        last_id INTEGER NOT NULL DEFAULT 0
    );
`;

const PRODIGY_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS prodigy (
        cobutech_serial VARCHAR(15) PRIMARY KEY,
        phone_number VARCHAR(20),
        bot_name VARCHAR(255) NOT NULL,
        bot_version VARCHAR(50),
        connection_method VARCHAR(10) NOT NULL,
        connection_mode VARCHAR(10) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'SETUP_INITIATED',
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
`;

const CONNECTIONS_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS connections (
        cobu_serial VARCHAR(10) PRIMARY KEY,
        phone_number VARCHAR(20) UNIQUE,
        bot_name VARCHAR(255) NOT NULL,
        session_status VARCHAR(50) NOT NULL DEFAULT 'OFFLINE',
        last_active TIMESTAMPTZ DEFAULT NOW()
    );
`;

async function getNextSerial(prefix) {
    await query(
        `INSERT INTO serial_tracker (name, last_id) VALUES ($1, 0) ON CONFLICT (name) DO NOTHING`,
        [prefix]
    );

    const res = await query(
        `UPDATE serial_tracker SET last_id = last_id + 1 WHERE name = $1 RETURNING last_id`,
        [prefix]
    );

    const nextId = res.rows[0].last_id;

    if (nextId > 99999) {
        throw new Error(`Serial ID counter for ${prefix} exceeded 99999.`);
    }

    const paddedId = String(nextId).padStart(5, '0');
    return `${prefix}${paddedId}`;
}

async function getNextConnectionSerial() {
    return getNextSerial('COBU');
}

export async function initializeConnectionTables(systemLogs) {
    try {
        await query(SERIAL_TRACKER_SQL);
        await query(PRODIGY_TABLE_SQL);
        await query(CONNECTIONS_TABLE_SQL);
        return true;
    } catch (err) {
        return false;
    }
}

export async function handleDirectPairingCode(req, res) {
    const { botName, method, mode, phoneNumber } = req.body;

    if (!botName || !phoneNumber) {
        return res.status(400).json({ success: false, message: "Missing bot name or phone number." });
    }

    let cobutechSerial;
    try {
        cobutechSerial = await getNextSerial('COBUTECH');
    } catch (error) {
        return res.status(500).json({ success: false, message: `Failed to generate COBUTECH ID.` });
    }

    try {
        const versionMatch = botName.match(/V\s[\d\.]+/);
        const botVersion = versionMatch ? versionMatch[0] : 'N/A';

        await query(
            `INSERT INTO prodigy 
            (cobutech_serial, phone_number, bot_name, bot_version, connection_method, connection_mode, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [cobutechSerial, phoneNumber, botName, botVersion, method, mode, 'PENDING_CODE']
        );

    } catch (error) {
        return res.status(500).json({ success: false, message: `DB Insertion failed.` });
    }

    try {
        const code = await generatePairingCode(phoneNumber, cobutechSerial);

        await query(
            `UPDATE prodigy SET status = $1 WHERE cobutech_serial = $2`,
            ['CODE_SENT', cobutechSerial]
        );

        res.status(200).json({
            success: true,
            pairingCode: code,
            cobutechSerial: cobutechSerial
        });

    } catch (error) {
        await query(
            `UPDATE prodigy SET status = $1 WHERE cobutech_serial = $2`,
            [`PAIR_FAILED`, cobutechSerial]
        );

        res.status(500).json({
            success: false,
            message: `Connection initiation failed.`
        });
    }
}

export async function finalizeBotConnection(req, res) {
    const { cobutechSerial } = req.body;

    if (!cobutechSerial) {
        return res.status(400).json({ success: false, message: "Missing COBUTECH Serial ID." });
    }

    try {
        const prodigyRes = await query(
            'SELECT * FROM prodigy WHERE cobutech_serial = $1 AND status != $2', 
            [cobutechSerial, 'PAIRED']
        );

        if (prodigyRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Invalid or already connected session ID." });
        }
        
        const session = prodigyRes.rows[0];

        const clientDetails = await startBotSession(session.phone_number, session.cobutech_serial);

        const cobuSerial = await getNextConnectionSerial();

        await query(
            `UPDATE prodigy SET status = $1, phone_number = $2 WHERE cobutech_serial = $3`,
            ['PAIRED', clientDetails.phoneNumber, cobutechSerial]
        );

        await query(
            `INSERT INTO connections 
            (cobu_serial, phone_number, bot_name, session_status)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (phone_number) DO UPDATE SET
            bot_name = EXCLUDED.bot_name, session_status = $4, last_active = NOW()`,
            [cobuSerial, clientDetails.phoneNumber, session.bot_name, 'ONLINE']
        );

        return res.status(200).json({
            success: true,
            message: `Bot ${session.bot_name} is now ONLINE.`,
            cobuSerial: cobuSerial
        });

    } catch (error) {
        await query(
            `UPDATE prodigy SET status = $1 WHERE cobutech_serial = $2`,
            [`LOGIN_FAILED`, cobutechSerial]
        );
        return res.status(500).json({
            success: false,
            message: `Final connection failed: ${error.message}`
        });
    }
}