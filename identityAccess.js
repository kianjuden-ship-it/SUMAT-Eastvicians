const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { canListReports, getPermissions } = require('../utils/permissions');

const router = express.Router();

// GET /api/analytics/summary - counts + category breakdown, safe for every role
// including SSLG (summary-only). Note: there is no student login/registration in this
// system (see README), so "students per grade" is approximated from report submissions
// rather than true registration counts.
router.get('/summary', requireAuth, async (req, res) => {
  const { role, id } = req.admin;
  if (!canListReports(role)) return res.status(403).json({ error: 'Your role does not have access to report statistics.' });

  const permissions = getPermissions(role);
  try {
    const rows = permissions.assignedOnly
      ? (await pool.query('SELECT status, priority, category_key, reporter_grade_level FROM reports WHERE assigned_counselor_id = $1', [id])).rows
      : (await pool.query('SELECT status, priority, category_key, reporter_grade_level FROM reports')).rows;

    const statuses = ['Submitted', 'Under Review', 'Investigation Ongoing', 'Counseling/Intervention', 'Action Taken', 'Closed'];
    const byStatus = {};
    for (const status of statuses) byStatus[status] = rows.filter((r) => r.status === status).length;

    const byCategory = {};
    for (const row of rows) byCategory[row.category_key] = (byCategory[row.category_key] || 0) + 1;

    const byGrade = {};
    for (const row of rows) if (row.reporter_grade_level) byGrade[row.reporter_grade_level] = (byGrade[row.reporter_grade_level] || 0) + 1;

    res.json({
      total: rows.length,
      pending: byStatus['Submitted'] + byStatus['Under Review'],
      activeInvestigations: byStatus['Investigation Ongoing'] + byStatus['Counseling/Intervention'],
      resolved: byStatus['Action Taken'] + byStatus['Closed'],
      highPriority: rows.filter((r) => r.priority === 'High').length,
      byStatus,
      byCategory,
      byGrade
    });
  } catch (error) {
    console.error('Analytics error', error);
    res.status(500).json({ error: 'Analytics could not be loaded right now.' });
  }
});

module.exports = router;
