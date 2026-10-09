-- 038_church_ministry.sql
--
-- The public face of the parish: who leads it, what the ministry is, and who is on the council.
--
-- The landing page at `/` is the first thing a visitor sees and, until now, it was a hardcoded
-- paragraph written by a developer. Anything true about a parish changes -- a priest is appointed or
-- retires, the council is elected every two years, the ministry's story is corrected -- and none of that
-- should need a deploy to reflect. So it is data, edited by the one role that owns the record.
--
-- Two tables rather than one settings key per field:
--
--   church_profile  -- one row, ever. See below for why the singleton is enforced in the database.
--   council_members -- a list. A key/value store cannot express "the fourth item, in this order", and
--                      council seats get reordered and vacated far more often than they get created.
--
-- --------------------------------------------------------------------------------------
-- The parish name is deliberately NOT here
-- --------------------------------------------------------------------------------------
-- `church_name` already exists in system_settings and is what every report and PDF header prints. A
-- second copy in church_profile would be a second answer to "what is this parish called", and the two
-- would drift the first time somebody changed one and not the other. The landing page reads the
-- setting; this table holds only what the setting cannot express.
--
-- --------------------------------------------------------------------------------------
-- Why the singleton is enforced by an index, not by convention
-- --------------------------------------------------------------------------------------
-- A `CHECK` cannot see other rows, so "there is at most one" is not expressible that way. The unique
-- index on a constant expression is the standard trick: every row computes the same key, so the second
-- insert violates it. `ON CONFLICT DO UPDATE` then turns a duplicate into an update, which is exactly
-- the upsert every write path wants -- and unlike the announcements' partial dedupe index, this one is
-- a plain index and PostgREST can infer it as an arbiter without being asked to.
CREATE TABLE IF NOT EXISTS church_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who leads the parish. Free text rather than a members row: the parish priest is very often not a
  -- member of this system, and a foreign key would mean creating a member record for a name that
  -- appears in no roster.
  priest_name text,
  -- One line under the heading. Empty means the landing page falls back to its own default rather than
  -- printing a blank.
  headline text,
  -- The ministry's background, as paragraphs. Plain text with blank lines between them; the page turns
  -- those into paragraphs. Kept out of the headline so the two can change independently.
  about text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE church_profile IS
  'At most one row. The public identity of the parish, edited by the super admin and read by the landing page. The parish name lives in system_settings.church_name so reports and this page cannot disagree.';
COMMENT ON COLUMN church_profile.priest_name IS
  'Free text, not a members reference: the parish priest is often not a member of this system.';
COMMENT ON COLUMN church_profile.about IS
  'The ministry''s background. Blank lines separate paragraphs; the page renders one <p> each.';

-- The constant key. See above.
CREATE UNIQUE INDEX IF NOT EXISTS church_profile_singleton
  ON church_profile ((true));

-- Seeded so the first read is a defined empty state rather than "no row", and so a super admin opening
-- the editor to add a priest does not also have to create the row first.
INSERT INTO church_profile (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------------------------------
-- The council
-- --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS council_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- "Council President", "P Auditor", "Treasurer", and so on. Not a lookup table: the offices are
  -- particular to this parish and a fixed list would be a guess about a church I have never seen.
  office text,
  bio text,
  -- Initials are derived rather than stored, so a member with no photo shows their name's initials
  -- instead of a broken image or an empty grey box. No upload pipeline is built here on purpose: an
  -- image field nobody can fill is worse than none, and this can be added when there is a real need.
  sort_order int NOT NULL DEFAULT 0,
  -- Vacated rather than deleted. A council page that quietly loses a name when somebody leaves reads
  -- as a mistake, and the roster needs to keep the seat in its historical order.
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS council_members_active_sort
  ON council_members (is_active, sort_order);

ALTER TABLE church_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE council_members ENABLE ROW LEVEL SECURITY;

-- No policies. Every read and write goes through the service role in an API route that calls
-- `requireRole`, so the browser never talks to these tables directly. That is the same arrangement the
-- announcements and liturgy tables use: a public table with no client policy is unreachable from a
-- browser, and the route is the only door.