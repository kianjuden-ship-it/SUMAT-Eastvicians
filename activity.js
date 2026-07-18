const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getPermissions } = require('../utils/permissions');

const router = express.Router();

// Full account creation/editing is out of scope for this pass — accounts are provisioned
// via backend/scripts/seed-admins.js so passwords are never handled by the browser.

// GET /api/users - Principal only: full account list for account management.
router.get('/', requireAuth, requireRole('PRINCIPAL'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, full_name, username, role, status, created_at, last_login FROM users ORDER BY created_at ASC');
    res.json({ users: result.rows.map((row) => ({ ...row, role_label: getPermissions(row.role)?.label || row.role })) });
  } catch (error) {
    console.error('User list error', error);
    res.status(500).json({ error: 'Administrator accounts could not be loaded right now.' });
  }
});

// GET /api/users/counselors - Principal & Child Protection Officer: minimal list so a
// case can be assigned to a specific counselor.
router.get('/counselors', requireAuth, requireRole('PRINCIPAL', 'CHILD_PROTECTION_OFFICER'), async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, full_name FROM users WHERE role = 'COUNSELOR' AND status = 'ACTIVE' ORDER BY full_name ASC`);
    res.json({ counselors: result.rows });
  } catch (error) {
    console.error('Counselor list error', error);
    res.status(500).json({ error: 'Counselor list could not be loaded right now.' });
  }
});

module.exports = router;
