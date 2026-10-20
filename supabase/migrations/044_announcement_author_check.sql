-- 044_announcement_author_check.sql
--
-- Posting an announcement failed with:
--
--   new row for relation "announcements" violates check constraint
--   "announcements_created_by_check"
--
-- The constraint live on the database was the one from 002:
--
--   CHECK (created_by IN ('admin', 'secretary'))
--
-- 008 widened it for the officer and 015 widened it again for the birthday job's
-- `system` rows, but neither of those files is applied. Meanwhile the app has
-- been inserting the session's own role, and `super_admin` reaches the admin
-- section (`ROLE_REACH`), so the super admin passes the route's guard and the
-- value that lands in the column is `super_admin` -- exactly what the live
-- constraint refuses. That is the error the parish saw.
--
-- This is the whole diagnosis: the constraint has been migrated twice and the
-- app's role list has only ever been written down in the app.
--
-- The rule this file encodes: an author is whoever the session says posted it,
-- plus `system` for the generators. The check exists to stop a garbage author (an
-- empty string, a client-invented name), not to enumerate who may post -- the
-- route already refuses anyone who is not `admin`/`secretary`/`officer` (and so
-- `super_admin`, which reaches them) before it inserts.
--
-- `treasurer` is included even though it cannot post today: it is in the role
-- list the feed is written against, and a stale author list is precisely the bug
-- this file is fixing. It is not a grant of anything.

ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_created_by_check;

ALTER TABLE announcements ADD CONSTRAINT announcements_created_by_check
  CHECK (created_by IN ('admin', 'secretary', 'officer', 'treasurer', 'super_admin', 'system'));

-- Evidence of what the database now believes, so a later reader does not have to
-- guess which of the three files won.
COMMENT ON CONSTRAINT announcements_created_by_check ON announcements IS
  'Who may be recorded as an announcement author. Roles, from the session, plus system for generators. Widened by 008, 015 and 044; 044 supersedes both.';
