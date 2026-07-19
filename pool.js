const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
});

pool.on('error', (err) => {
  console.error('Unexpected database error', err);
});

module.exports = pool;
