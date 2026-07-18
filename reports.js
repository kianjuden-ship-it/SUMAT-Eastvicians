const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { getPermissions } = require('../utils/permissions');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Slows down credential-stuffing / brute-force attempts against admin accounts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a few minutes.' }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, full_name, username, password_hash, role, status FROM users WHERE username = $1',
      [String(username).trim()]
    );
    const account = result.rows[0];

    // Compare against a dummy hash when the account doesn't exist so response
    // timing doesn't reveal whether a username is valid.
    const hashToCheck = account ? account.password_hash : '$2a$12$abcdefghijklmnopqrstuvGkTt5f0P1qF1S1gk1z1e1a1b1c1d1e1O';
    const passwordMatches = await bcrypt.compare(password, hashToCheck);

    if (!account || !passwordMatches || account.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const permissions = getPermissions(account.role);
    const token = jwt.sign(
      { id: account.id, username: account.username, fullName: account.full_name, role: account.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [account.id]);
    await pool.query(
      'INSERT INTO admin_activity_logs (admin_name, role, action) VALUES ($1, $2, $3)',
      [account.full_name, permissions.label, 'Administrator login']
    );

    res.json({
      token,
      admin: {
        id: account.id,
        fullName: account.full_name,
        username: account.username,
        role: account.role,
        roleLabel: permissions.label,
        roleType: permissions.roleType,
        access: permissions.access,
        canManageUsers: permissions.canManageUsers,
        canManageSystem: permissions.canManageSystem,
        canApproveIdentityAccess: permissions.canApproveIdentityAccess,
        canRequestIdentityAccess: permissions.canRequestIdentityAccess,
        canAssignCounselor: permissions.canAssignCounselor,
        canViewAuditLog: permissions.canViewAuditLog,
        canDeleteReports: permissions.canDeleteReports,
        viewAll: permissions.viewAll,
        summaryOnly: permissions.summaryOnly,
        assignedOnly: permissions.assignedOnly
      }
    });
  } catch (error) {
    console.error('Login error', error);
    res.status(500).json({ error: 'Login could not be completed right now.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const permissions = getPermissions(req.admin.role);
  res.json({
    admin: {
      id: req.admin.id,
      fullName: req.admin.fullName,
      username: req.admin.username,
      role: req.admin.role,
      roleLabel: permissions.label,
      roleType: permissions.roleType,
      access: permissions.access,
      canManageUsers: permissions.canManageUsers,
      canManageSystem: permissions.canManageSystem,
      canApproveIdentityAccess: permissions.canApproveIdentityAccess,
      canRequestIdentityAccess: permissions.canRequestIdentityAccess,
      canAssignCounselor: permissions.canAssignCounselor,
      canViewAuditLog: permissions.canViewAuditLog,
      canDeleteReports: permissions.canDeleteReports,
      viewAll: permissions.viewAll,
      summaryOnly: permissions.summaryOnly,
      assignedOnly: permissions.assignedOnly
    }
  });
});

router.post('/logout', requireAuth, async (req, res) => {
  const permissions = getPermissions(req.admin.role);
  await pool.query(
    'INSERT INTO admin_activity_logs (admin_name, role, action) VALUES ($1, $2, $3)',
    [req.admin.fullName, permissions.label, 'Administrator logout']
  );
  res.json({ success: true });
});

module.exports = router;
