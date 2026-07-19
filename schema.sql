-- SUMAT Eastvicians database schema (v2 -- child protection / student welfare workflow)
-- Students never create accounts (the portal uses a per-report verification form,
-- not a login), so only staff/admin accounts live in the users table.

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'PRINCIPAL',                 -- SUPER_ADMIN
    'CHILD_PROTECTION_OFFICER',  -- CASE_MANAGER
    'SSLG_PRESIDENT',            -- SYSTEM_MONITOR
    'COUNSELOR',                 -- STUDENT_SUPPORT
    'SYSTEM_OPERATOR'            -- technical administration only, no case access
  )),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  report_id TEXT NOT NULL UNIQUE,
  reporter_alias TEXT NOT NULL, -- e.g. "SUMAT-014", shown instead of the real name until identity access is approved
  reporter_full_name TEXT NOT NULL,
  reporter_grade_level TEXT NOT NULL,
  reporter_section TEXT NOT NULL,
  reporter_student_id TEXT,
  privacy_mode TEXT NOT NULL CHECK (privacy_mode IN ('confidential_report', 'protected_identity')),
  category_key TEXT NOT NULL,
  category_label TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('High', 'Medium', 'Low')),
  incident_date DATE,
  incident_location TEXT,
  persons_involved TEXT,
  description TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_office TEXT,
  assigned_personnel TEXT,
  internal_notes TEXT,
  assigned_counselor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  counselor_status TEXT DEFAULT 'Not Started' CHECK (counselor_status IN (
    'Not Started', 'Initial Assessment', 'Follow-up Needed', 'Follow-up Scheduled', 'Completed'
  )),
  counselor_notes TEXT,
  follow_up_date DATE,
  status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN (
    'Submitted', 'Under Review', 'Investigation Ongoing', 'Counseling/Intervention', 'Action Taken', 'Closed'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status);
CREATE INDEX IF NOT EXISTS reports_category_idx ON reports(category_key);
CREATE INDEX IF NOT EXISTS reports_created_at_idx ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS reports_counselor_idx ON reports(assigned_counselor_id);

CREATE TABLE IF NOT EXISTS report_history (
  id BIGSERIAL PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  changed_by TEXT,
  remarks TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Identity access requests implement "identity access must require authorization":
-- a Case Manager (CPO) requests access to a Protected Identity report's real identity,
-- and only the Principal can approve or deny it. Every decision is auditable.
CREATE TABLE IF NOT EXISTS identity_access_requests (
  id BIGSERIAL PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  requested_by BIGINT NOT NULL REFERENCES users(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  decided_by BIGINT REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_name TEXT NOT NULL,
  role TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_sequence (
  sequence_key INTEGER PRIMARY KEY CHECK (sequence_key = 1),
  current_value BIGINT NOT NULL DEFAULT 0
);

INSERT INTO report_sequence (sequence_key, current_value)
VALUES (1, 0)
ON CONFLICT (sequence_key) DO NOTHING;
