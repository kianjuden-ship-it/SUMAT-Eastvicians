require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

// Kian Jude remains the System Operator / Platform Administrator (technical administration
// only, no case-content access) per the earlier project requirement. The four official
// roles below use the demo credentials specified for this build.
const accounts = [
  { full_name: 'Kian Jude', username: 'KianJude1', password: 'kianjuden14344', role: 'SYSTEM_OPERATOR' },
  { full_name: 'School Principal', username: 'EVRSHS.Principal2026', password: 'EVR@Admin26#', role: 'PRINCIPAL' },
  { full_name: 'Child Protection Officer', username: 'EVRSHS.CPO2026', password: 'CPO_Safe26!', role: 'CHILD_PROTECTION_OFFICER' },
  { full_name: 'SSLG President', username: 'SSLG.President26', password: 'SSLG_Report26!', role: 'SSLG_PRESIDENT' },
  { full_name: 'School Counselor', username: 'EVRSHS.Counselor2026', password: 'Counselor.Safe26!', role: 'COUNSELOR' }
];

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);

  for (const account of accounts) {
    const passwordHash = await bcrypt.hash(account.password, 12);
    await pool.query(
      `INSERT INTO users (full_name, username, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         status = 'ACTIVE'`,
      [account.full_name, account.username, passwordHash, account.role]
    );
    console.log(`Seeded ${account.username} (${account.role})`);
  }

  console.log('\nDone. Change these default passwords after first login in a production deployment.');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
