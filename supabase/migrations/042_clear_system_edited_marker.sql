-- 042_clear_system_edited_marker.sql
--
-- Birthday greetings were inserted with `updated_at` set, so the feed printed
-- "· Edited" on a post no human ever touched. The insert no longer sends it
-- (and the generator helper strips it defensively), but rows already written
-- keep the marker until their 24h `delete_at` removes them -- including the
-- greeting on screen today.
--
-- System rows can never be human-edited (PATCH refuses `created_by =
-- 'system'`), so `updated_at` on them is always spurious, never a real edit
-- being recorded. Clearing it loses nothing.
UPDATE announcements
SET updated_at = NULL
WHERE created_by = 'system' AND updated_at IS NOT NULL;
