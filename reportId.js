// Role permission model for the 4 official roles plus the pre-existing technical
// System Operator account (Kian Jude), who has no case-content access at all.
//
//   viewAll        - sees every report in full detail, sees real identities by default
//   summaryOnly     - sees a report list, but only non-sensitive summary fields
//                     (category, status, priority, dates) -- never description,
//                     identity, or internal notes
//   assignedOnly    - sees only reports explicitly assigned to them (Counselor)
//   canManageUsers  - may manage administrator accounts (Principal only)
//   canManageSystem - may view system/technical administration screens
//   canApproveIdentityAccess - may approve/deny requests to reveal a protected identity
//   canRequestIdentityAccess - may request access to a protected identity
//   canAssignCounselor       - may assign a case to the Counselor
//   canViewAuditLog          - may view the audit log
//   canDeleteReports         - may permanently delete a report (Principal only, per spec)
const ROLE_PERMISSIONS = {
  PRINCIPAL: {
    viewAll: true, summaryOnly: false, assignedOnly: false,
    canManageUsers: true, canManageSystem: false,
    canApproveIdentityAccess: true, canRequestIdentityAccess: true,
    canAssignCounselor: true, canViewAuditLog: true, canDeleteReports: true,
    label: 'Principal', roleType: 'SUPER_ADMIN', access: 'Full System Access'
  },
  CHILD_PROTECTION_OFFICER: {
    viewAll: true, summaryOnly: false, assignedOnly: false,
    canManageUsers: false, canManageSystem: false,
    canApproveIdentityAccess: false, canRequestIdentityAccess: true,
    canAssignCounselor: true, canViewAuditLog: false, canDeleteReports: false,
    label: 'Child Protection Officer', roleType: 'CASE_MANAGER', access: 'Case Investigation'
  },
  SSLG_PRESIDENT: {
    viewAll: false, summaryOnly: true, assignedOnly: false,
    canManageUsers: false, canManageSystem: false,
    canApproveIdentityAccess: false, canRequestIdentityAccess: false,
    canAssignCounselor: false, canViewAuditLog: false, canDeleteReports: false,
    label: 'SSLG President', roleType: 'SYSTEM_MONITOR', access: 'Platform Monitoring'
  },
  COUNSELOR: {
    viewAll: false, summaryOnly: false, assignedOnly: true,
    canManageUsers: false, canManageSystem: false,
    canApproveIdentityAccess: false, canRequestIdentityAccess: false,
    canAssignCounselor: false, canViewAuditLog: false, canDeleteReports: false,
    label: 'School Counselor', roleType: 'STUDENT_SUPPORT', access: 'Assigned Welfare Cases'
  },
  SYSTEM_OPERATOR: {
    viewAll: false, summaryOnly: false, assignedOnly: false,
    canManageUsers: false, canManageSystem: true,
    canApproveIdentityAccess: false, canRequestIdentityAccess: false,
    canAssignCounselor: false, canViewAuditLog: false, canDeleteReports: false,
    label: 'System Operator / Platform Administrator', roleType: 'TECHNICAL', access: 'Technical Administration'
  }
};

function getPermissions(role) {
  return ROLE_PERMISSIONS[role] || null;
}

// Whether a role can list/see reports at all (list level).
function canListReports(role) {
  const permissions = getPermissions(role);
  if (!permissions) return false;
  return permissions.viewAll || permissions.summaryOnly || permissions.assignedOnly;
}

// Whether reporter identity should be masked (showing the alias instead of the real name)
// for this admin viewing this specific report. Identity access for Protected Identity
// reports requires an approved identity_access_requests row; pass `hasApprovedAccess`
// after checking that table.
function shouldMaskIdentity({ role, report, hasApprovedAccess }) {
  const permissions = getPermissions(role);
  if (!permissions) return true;
  if (permissions.summaryOnly) return true; // SSLG never sees identity
  if (permissions.viewAll) return false; // Principal & CPO are "authorized officials"

  // Counselor: assigned Confidential Report cases were deliberately routed to them by the
  // CPO, so identity is visible. Protected Identity cases stay masked until approved,
  // same as everyone else.
  if (permissions.assignedOnly) {
    if (report.privacy_mode === 'confidential_report') return false;
    return !hasApprovedAccess;
  }

  return !hasApprovedAccess;
}

module.exports = { ROLE_PERMISSIONS, getPermissions, canListReports, shouldMaskIdentity };
