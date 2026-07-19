const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const upload = require('../middleware/upload');
const { requireAuth, requireRole } = require('../middleware/auth');
const { nextReportSequence } = require('../utils/reportId');
const { CATEGORIES } = require('../utils/categories');
const { getPermissions, canListReports, shouldMaskIdentity } = require('../utils/permissions');

const router = express.Router();

const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this device. Please try again later.' }
});

const PRIVACY_MODE_MAP = {
  'Confidential Report': 'confidential_report',
  'Protected Identity Report': 'protected_identity'
};

const ALLOWED_STATUSES = ['Submitted', 'Under Review', 'Investigation Ongoing', 'Counseling/Intervention', 'Action Taken', 'Closed'];

// Looks up whether the given admin has an approved identity_access_requests row for this report.
async function hasApprovedIdentityAccess(reportId, adminId) {
  const result = await pool.query(
    `SELECT 1 FROM identity_access_requests WHERE report_id = $1 AND requested_by = $2 AND status = 'approved' LIMIT 1`,
    [reportId, adminId]
  );
  return result.rows.length > 0;
}

function toPublicReport(row) {
  return { report_id: row.report_id, status: row.status, created_at: row.created_at, updated_at: row.updated_at };
}

async function toAdminReport(row, admin) {
  const permissions = getPermissions(admin.role);
  const approvedAccess = permissions.viewAll ? true : await hasApprovedIdentityAccess(row.report_id, admin.id);
  const masked = shouldMaskIdentity({ role: admin.role, report: row, hasApprovedAccess: approvedAccess });

  const base = {
    report_id: row.report_id,
    category_key: row.category_key,
    category_label: row.category_label,
    priority: row.priority,
    status: row.status,
    assigned_office: row.assigned_office,
    assigned_personnel: row.assigned_personnel,
    assigned_counselor_id: row.assigned_counselor_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    incident_date: row.incident_date,
    incident_location: row.incident_location
  };

  if (permissions.summaryOnly) {
    // SSLG President: non-sensitive summary only, never identity/description/notes.
    return base;
  }

  return {
    ...base,
    reporter_display_name: masked ? `Reporter #${row.reporter_alias}` : row.reporter_full_name,
    reporter_identity_masked: masked,
    reporter_grade_level: row.reporter_grade_level,
    reporter_section: masked ? 'Restricted until identity access is approved' : row.reporter_section,
    reporter_student_id: masked ? 'Restricted until identity access is approved' : row.reporter_student_id,
    privacy_mode: row.privacy_mode,
    persons_involved: row.persons_involved,
    description: row.description,
    attachments: row.attachments,
    internal_notes: row.internal_notes,
    counselor_status: row.counselor_status,
    counselor_notes: permissions.assignedOnly || permissions.viewAll ? row.counselor_notes : undefined,
    follow_up_date: row.follow_up_date
  };
}

// POST /api/reports - public submission from the verification + multi-step reporting form
router.post('/', submitLimiter, upload.array('evidence_files[]', 10), async (req, res) => {
  const body = req.body || {};
  const files = req.files || [];

  const requiredFields = ['reporter_full_name', 'reporter_grade_level', 'reporter_section', 'report_category', 'privacy_mode'];
  for (const field of requiredFields) {
    if (!body[field] || !String(body[field]).trim()) {
      return res.status(400).json({ error: `Missing required field: ${field}` });
    }
  }

  const categoryKey = body.report_category;
  const category = CATEGORIES[categoryKey];
  if (!category) return res.status(400).json({ error: 'Unknown report category.' });

  const privacyMode = PRIVACY_MODE_MAP[body.privacy_mode];
  if (!privacyMode) return res.status(400).json({ error: 'Please choose a reporter privacy option.' });

  const description = (body.report_description || '').trim();
  if (!description) return res.status(400).json({ error: 'Please describe what happened.' });

  try {
    const { reportId, reporterAlias } = await nextReportSequence();
    const result = await pool.query(
      `INSERT INTO reports (
        report_id, reporter_alias, reporter_full_name, reporter_grade_level, reporter_section, reporter_student_id,
        privacy_mode, category_key, category_label, priority, incident_date, incident_location, persons_involved,
        description, attachments, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Submitted')
      RETURNING report_id, status, created_at`,
      [
        reportId,
        reporterAlias,
        body.reporter_full_name.trim(),
        body.reporter_grade_level.trim(),
        body.reporter_section.trim(),
        body.reporter_student_id ? body.reporter_student_id.trim() : null,
        privacyMode,
        categoryKey,
        category.label,
        category.priority,
        body.incident_date || null,
        body.incident_location ? body.incident_location.trim() : null,
        body.persons_involved ? body.persons_involved.trim() : null,
        description,
        JSON.stringify(files.map((file) => ({ original_name: file.originalname, stored_name: file.filename, size_bytes: file.size, mime_type: file.mimetype })))
      ]
    );

    await pool.query(
      `INSERT INTO report_history (report_id, previous_status, new_status, changed_by, remarks)
       VALUES ($1, NULL, 'Submitted', 'System', 'Report submitted by student')`,
      [reportId]
    );

    res.status(201).json({ report_id: result.rows[0].report_id, status: result.rows[0].status, created_at: result.rows[0].created_at });
  } catch (error) {
    console.error('Report submission error', error);
    res.status(500).json({ error: 'Your report could not be submitted right now. Please try again.' });
  }
});

// GET /api/reports/track/:reportId - public status lookup, no identity or description exposed
router.get('/track/:reportId', async (req, res) => {
  try {
    const result = await pool.query('SELECT report_id, status, created_at, updated_at FROM reports WHERE report_id = $1', [req.params.reportId.trim().toUpperCase()]);
    if (!result.rows[0]) return res.status(404).json({ error: 'No report found with that Report ID.' });

    const history = await pool.query('SELECT new_status AS status, timestamp FROM report_history WHERE report_id = $1 ORDER BY timestamp ASC', [result.rows[0].report_id]);
    res.json({ ...toPublicReport(result.rows[0]), timeline: history.rows });
  } catch (error) {
    console.error('Tracking error', error);
    res.status(500).json({ error: 'Report status could not be retrieved right now.' });
  }
});

// GET /api/reports - admin list, scoped per role (all / summary-only / assigned-only)
router.get('/', requireAuth, async (req, res) => {
  const { role, id } = req.admin;
  if (!canListReports(role)) return res.status(403).json({ error: 'Your role does not have access to report data.' });

  const permissions = getPermissions(role);
  try {
    const result = permissions.assignedOnly
      ? await pool.query('SELECT * FROM reports WHERE assigned_counselor_id = $1 ORDER BY created_at DESC', [id])
      : await pool.query('SELECT * FROM reports ORDER BY created_at DESC');

    const reports = await Promise.all(result.rows.map((row) => toAdminReport(row, req.admin)));
    res.json({ reports });
  } catch (error) {
    console.error('List reports error', error);
    res.status(500).json({ error: 'Reports could not be loaded right now.' });
  }
});

async function loadReportForAdmin(reportId, admin) {
  const result = await pool.query('SELECT * FROM reports WHERE report_id = $1', [reportId]);
  const row = result.rows[0];
  if (!row) return { row: null };

  const permissions = getPermissions(admin.role);
  const allowed = permissions.viewAll || permissions.summaryOnly || (permissions.assignedOnly && row.assigned_counselor_id === admin.id);
  return { row, allowed };
}

// GET /api/reports/:reportId - admin detail view
router.get('/:reportId', requireAuth, async (req, res) => {
  try {
    const { row, allowed } = await loadReportForAdmin(req.params.reportId, req.admin);
    if (!row) return res.status(404).json({ error: 'Report not found.' });
    if (!allowed) return res.status(403).json({ error: 'This report is outside your assigned permission scope.' });

    const history = await pool.query('SELECT previous_status, new_status, changed_by, remarks, timestamp FROM report_history WHERE report_id = $1 ORDER BY timestamp ASC', [row.report_id]);
    const permissions = getPermissions(req.admin.role);

    if (permissions.canViewAuditLog || permissions.viewAll) {
      await pool.query('INSERT INTO admin_activity_logs (admin_name, role, action) VALUES ($1, $2, $3)', [
        req.admin.fullName, permissions.label, `${permissions.label} viewed case ${row.report_id}`
      ]);
    }

    const adminReport = await toAdminReport(row, req.admin);
    res.json({ ...adminReport, timeline: history.rows });
  } catch (error) {
    console.error('Report detail error', error);
    res.status(500).json({ error: 'Report details could not be loaded right now.' });
  }
});

// PATCH /api/reports/:reportId - Principal / Child Protection Officer update the official
// investigation status, assignment, and internal notes.
router.patch('/:reportId', requireAuth, requireRole('PRINCIPAL', 'CHILD_PROTECTION_OFFICER'), async (req, res) => {
  const { status, assigned_office: assignedOffice, assigned_personnel: assignedPersonnel, internal_notes: internalNotes } = req.body || {};
  if (status && !ALLOWED_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status value.' });

  try {
    const existing = await pool.query('SELECT * FROM reports WHERE report_id = $1', [req.params.reportId]);
    const row = existing.rows[0];
    if (!row) return res.status(404).json({ error: 'Report not found.' });

    const nextStatus = status || row.status;
    const updated = await pool.query(
      `UPDATE reports SET status = $1, assigned_office = $2, assigned_personnel = $3, internal_notes = $4, updated_at = NOW()
       WHERE report_id = $5 RETURNING *`,
      [nextStatus, assignedOffice ?? row.assigned_office, assignedPersonnel ?? row.assigned_personnel, internalNotes ?? row.internal_notes, row.report_id]
    );

    const permissions = getPermissions(req.admin.role);
    if (nextStatus !== row.status) {
      await pool.query(
        `INSERT INTO report_history (report_id, previous_status, new_status, changed_by, remarks) VALUES ($1,$2,$3,$4,$5)`,
        [row.report_id, row.status, nextStatus, req.admin.fullName, internalNotes || null]
      );
    }

    await pool.query('INSERT INTO admin_activity_logs (admin_name, role, action) VALUES ($1, $2, $3)', [
      req.admin.fullName, permissions.label, `${permissions.label} updated status of ${row.report_id}${status ? `: ${status}` : ''}`
    ]);

    res.json(await toAdminReport(updated.rows[0], req.admin));
  } catch (error) {
    console.error('Report update error', error);
    res.status(500).json({ error: 'The case update could not be saved right now.' });
  }
});

// PATCH /api/reports/:reportId/assign-counselor - Principal / CPO forward a case to the Counselor
router.patch('/:reportId/assign-counselor', requireAuth, requireRole('PRINCIPAL', 'CHILD_PROTECTION_OFFICER'), async (req, res) => {
  const { counselor_id: counselorId } = req.body || {};
  if (!counselorId) return res.status(400).json({ error: 'counselor_id is required.' });

  try {
    const counselor = await pool.query(`SELECT id, full_name, role FROM users WHERE id = $1 AND role = 'COUNSELOR' AND status = 'ACTIVE'`, [counselorId]);
    if (!counselor.rows[0]) return res.status(400).json({ error: 'That account is not an active Counselor.' });

    const existing = await pool.query('SELECT * FROM reports WHERE report_id = $1', [req.params.reportId]);
    const row = existing.rows[0];
    if (!row) return res.status(404).json({ error: 'Report not found.' });

    const updated = await pool.query(
      `UPDATE reports SET assigned_counselor_id = $1, counselor_status = 'Not Started', status = 'Counseling/Intervention', updated_at = NOW()
       WHERE report_id = $2 RETURNING *`,
      [counselorId, row.report_id]
    );

    if (row.status !== 'Counseling/Intervention') {
      await pool.query(`INSERT INTO report_history (report_id, previous_status, new_status, changed_by, remarks) VALUES ($1,$2,$3,$4,$5)`, [
        row.report_id, row.status, 'Counseling/Intervention', req.admin.fullName, `Forwarded to counselor ${counselor.rows[0].full_name}`
      ]);
    }

    const permissions = getPermissions(req.admin.role);
    await pool.query('INSERT INTO admin_activity_logs (admin_name, role, action) VALUES ($1, $2, $3)', [
      req.admin.fullName, permissions.label, `${permissions.label} assigned case ${row.report_id} to Counselor ${counselor.rows[0].full_name}`
    ]);

    res.json(await toAdminReport(updated.rows[0], req.admin));
  } catch (error) {
    console.error('Counselor assignment error', error);
    res.status(500).json({ error: 'The case could not be assigned right now.' });
  }
});

// PATCH /api/reports/:reportId/counselor - Counselor adds notes/status for their assigned case only
router.patch('/:reportId/counselor', requireAuth, requireRole('COUNSELOR'), async (req, res) => {
  const { counselor_status: counselorStatus, counselor_notes: counselorNotes, follow_up_date: followUpDate } = req.body || {};
  const allowedCounselorStatuses = ['Not Started', 'Initial Assessment', 'Follow-up Needed', 'Follow-up Scheduled', 'Completed'];
  if (counselorStatus && !allowedCounselorStatuses.includes(counselorStatus)) return res.status(400).json({ error: 'Invalid counselor status.' });

  try {
    const existing = await pool.query('SELECT * FROM reports WHERE report_id = $1', [req.params.reportId]);
    const row = existing.rows[0];
    if (!row) return res.status(404).json({ error: 'Report not found.' });
    if (row.assigned_counselor_id !== req.admin.id) return res.status(403).json({ error: 'This case is not assigned to you.' });

    const updated = await pool.query(
      `UPDATE reports SET counselor_status = $1, counselor_notes = $2, follow_up_date = $3, updated_at = NOW() WHERE report_id = $4 RETURNING *`,
      [counselorStatus ?? row.counselor_status, counselorNotes ?? row.counselor_notes, followUpDate ?? row.follow_up_date, row.report_id]
    );

    await pool.query('INSERT INTO admin_activity_logs (admin_name, role, action) VALUES ($1, $2, $3)', [
      req.admin.fullName, 'School Counselor', `Counselor added intervention notes on ${row.report_id}`
    ]);

    res.json(await toAdminReport(updated.rows[0], req.admin));
  } catch (error) {
    console.error('Counselor update error', error);
    res.status(500).json({ error: 'The counseling update could not be saved right now.' });
  }
});

// DELETE /api/reports/:reportId - Principal only, permanent deletion (per spec: "Only Principal
// can permanently delete"). Requires a reason, which is written into the audit log entry so the
// record of *why* survives even though the report row itself (and its history/identity-access
// rows, via ON DELETE CASCADE) is gone. admin_activity_logs has no foreign key to reports, so
// this audit entry is untouched by the cascade.
router.delete('/:reportId', requireAuth, requireRole('PRINCIPAL'), async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason is required to delete a report.' });
  }

  try {
    const existing = await pool.query('SELECT report_id, attachments FROM reports WHERE report_id = $1', [req.params.reportId]);
    const row = existing.rows[0];
    if (!row) return res.status(404).json({ error: 'Report not found.' });

    await pool.query('DELETE FROM reports WHERE report_id = $1', [row.report_id]);

    await pool.query('INSERT INTO admin_activity_logs (admin_name, role, action) VALUES ($1, $2, $3)', [
      req.admin.fullName, 'Principal', `Principal deleted ${row.report_id} — Reason: ${String(reason).trim()}`
    ]);

    // Best-effort: remove evidence files from disk. Not critical to the deletion succeeding,
    // so failures here are logged but don't turn the request into an error response.
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    await Promise.all(
      (row.attachments || []).map((file) =>
        fs.unlink(path.join(uploadDir, file.stored_name)).catch(() => {})
      )
    );

    res.json({ success: true, report_id: row.report_id });
  } catch (error) {
    console.error('Report delete error', error);
    res.status(500).json({ error: 'The report could not be deleted right now.' });
  }
});

// GET /api/reports/:reportId/attachments/:storedName - authenticated evidence download
router.get('/:reportId/attachments/:storedName', requireAuth, async (req, res) => {
  try {
    const { row, allowed } = await loadReportForAdmin(req.params.reportId, req.admin);
    if (!row) return res.status(404).json({ error: 'Report not found.' });
    const permissions = getPermissions(req.admin.role);
    if (!allowed || permissions.summaryOnly) return res.status(403).json({ error: 'This report is outside your assigned permission scope.' });

    const attachment = (row.attachments || []).find((item) => item.stored_name === req.params.storedName);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found.' });

    res.download(path.join(process.env.UPLOAD_DIR || './uploads', attachment.stored_name), attachment.original_name);
  } catch (error) {
    console.error('Attachment download error', error);
    res.status(500).json({ error: 'The attachment could not be retrieved right now.' });
  }
});

module.exports = router;
