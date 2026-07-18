const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Per the spec, "View audit logs" is a Principal-only permission.
router.get('/', requireAuth, requireRole('PRINCIPAL'), async (req, res) => {
  try {
    const result = await pool.query('SELECT admin_name, role, action, created_at FROM admin_activity_logs ORDER BY created_at DESC LIMIT 300');
    res.json({ activity: result.rows });
  } catch (error) {
    console.error('Activity log error', error);
    res.status(500).json({ error: 'Activity logs could not be loaded right now.' });
  }
});

module.exports = router;
