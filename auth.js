const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getPermissions } = require('../utils/permissions');

const router = express.Router();

// POST /api/identity-access - Child Protection Officer requests access to a Protected
// Identity report's real identity.
router.post('/', requireAuth, requireRole('CHILD_PROTECTION_OFFICER'), async (req, res) => {
  const { report_id: reportId, reason } = req.body || {};
  if (!reportId) return res.status(400).json({ error: 'report_id is required.' });

  try {
    const report = await pool.query('SELECT report_id, privacy_mode FROM reports WHERE report_id = $1', [reportId]);
    if (!report.rows[0]) return res.status(404).json({ error: 'Report not found.' });
    if (report.rows[0].privacy_mode !== 'protected_identity') {
      return res.status(400).json({ error: 'This report is not a Protected Identity report and does not require an access request.' });
    }

    const result = await pool.query(
      `INSERT INTO identity_access_requests (report_id, requested_by, reason) VALUES ($1, $2, $3) RETURNING id, status, created_at`,
      [reportId, req.admin.id, reason || null]
    );

    await pool.query('INSERT INTO admin_activity_logs (admin_name, role, action) VALUES ($1, $2, $3)', [
      req.admin.fullName, 'Child Protection Officer', `Requested identity access for ${reportId}`
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Identity access request error', error);
    res.status(500).json({ error: 'The request could not be submitted right now.' });
  }
});

// GET /api/identity-access - Principal reviews pending requests
router.get('/', requireAuth, requireRole('PRINCIPAL'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT iar.id, iar.report_id, iar.reason, iar.status, iar.created_at, u.full_name AS requested_by_name
       FROM identity_access_requests iar JOIN users u ON u.id = iar.requested_by
       ORDER BY iar.created_at DESC`
    );
    res.json({ requests: result.rows });
  } catch (error) {
    console.error('Identity access list error', error);
    res.status(500).json({ error: 'Requests could not be loaded right now.' });
  }
});

// PATCH /api/identity-access/:id - Principal approves or denies
router.patch('/:id', requireAuth, requireRole('PRINCIPAL'), async (req, res) => {
  const { decision } = req.body || {};
  if (!['approved', 'denied'].includes(decision)) return res.status(400).json({ error: 'decision must be "approved" or "denied".' });

  try {
    const result = await pool.query(
      `UPDATE identity_access_requests SET status = $1, decided_by = $2, decided_at = NOW() WHERE id = $3 AND status = 'pending' RETURNING *`,
      [decision, req.admin.id, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Request not found or already decided.' });

    await pool.query('INSERT INTO admin_activity_logs (admin_name, role, action) VALUES ($1, $2, $3)', [
      req.admin.fullName, 'Principal', `Principal ${decision} identity access for ${result.rows[0].report_id}`
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Identity access decision error', error);
    res.status(500).json({ error: 'The decision could not be saved right now.' });
  }
});

module.exports = router;
