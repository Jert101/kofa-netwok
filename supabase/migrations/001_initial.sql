-- Knights of the Altar AMS — initial schema
-- Run in Supabase SQL Editor or via CLI. RLS on; only service role (server) bypasses.

-- ─── Settings (key-value) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Members ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS members_unique_active_name
  ON members (lower(trim(full_name)))
  WHERE is_active = true;

-- ─── Masses ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS masses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  default_sunday boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Attendance sessions (one row = one mass on one calendar day) ─────────────
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date date NOT NULL,
  mass_id uuid NOT NULL REFERENCES masses (id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date ON attendance_sessions (session_date);

-- ─── Attendance records (presence per session) ───────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES attendance_sessions (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_session ON attendance_records (session_id);

-- ─── Generated monthly reports ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_month date NOT NULL,
  title text NOT NULL,
  generated_by text NOT NULL CHECK (generated_by IN ('secretary', 'admin')),
  pdf_storage_path text,
  summary_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_month)
);

-- ─── In-app notifications (role-scoped reads on server) ───────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_role text NOT NULL CHECK (from_role IN ('admin', 'secretary', 'member', 'system')),
  to_role text NOT NULL CHECK (to_role IN ('admin', 'secretary')),
  title text NOT NULL,
  body text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_to_role ON notifications (to_role, created_at DESC);

-- ─── Archive (after report generation) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_sessions_archive (
  id uuid NOT NULL,
  session_date date NOT NULL,
  mass_id uuid NOT NULL,
  mass_name text,
  notes text,
  archived_at timestamptz NOT NULL DEFAULT now(),
  report_id uuid REFERENCES reports (id) ON DELETE SET NULL,
  PRIMARY KEY (id, archived_at)
);

CREATE TABLE IF NOT EXISTS attendance_records_archive (
  id uuid NOT NULL,
  session_id uuid NOT NULL,
  member_id uuid NOT NULL,
  member_name text,
  archived_at timestamptz NOT NULL DEFAULT now(),
  report_id uuid REFERENCES reports (id) ON DELETE SET NULL,
  PRIMARY KEY (id, archived_at)
);

-- ─── RLS: block direct anon/authenticated access; service role bypasses ─────
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE masses ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records_archive ENABLE ROW LEVEL SECURITY;

-- ─── Seed defaults (PIN for all roles: 1234 — change in Admin → Settings) ────
INSERT INTO system_settings (key, value) VALUES
  ('church_name', 'Knights of the Altar'),
  ('church_address', ''),
  ('report_title', 'Monthly Attendance Report'),
  ('report_timezone', 'Asia/Manila'),
  ('pin_admin_hash', '$2b$10$7yrGhMdqjtQKIOf08ElX.uZI0PWlqdPG7dmpoLNkU6QCVVEMPaqD.'),
  ('pin_secretary_hash', '$2b$10$7yrGhMdqjtQKIOf08ElX.uZI0PWlqdPG7dmpoLNkU6QCVVEMPaqD.'),
  ('pin_member_hash', '$2b$10$7yrGhMdqjtQKIOf08ElX.uZI0PWlqdPG7dmpoLNkU6QCVVEMPaqD.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO masses (name, default_sunday, is_active)
SELECT v.name, v.default_sunday, v.is_active
FROM (
  VALUES
    ('Sunday Mass'::text, true::boolean, true::boolean),
    ('Weekday Mass'::text, false::boolean, true::boolean)
) AS v(name, default_sunday, is_active)
WHERE NOT EXISTS (SELECT 1 FROM masses LIMIT 1);
