const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DB_URL,
    ssl: {
        rejectUnauthorized: false // Often needed for cloud DBs like Neon/Render
    }
});

pool.connect()
    .then(client => {
        console.log('✅ Database connected successfully.');
        client.release();
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.message);
    });

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};
