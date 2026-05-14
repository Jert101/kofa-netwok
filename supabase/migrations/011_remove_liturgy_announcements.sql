-- Liturgy server rosters are no longer mirrored into announcements (push-only from the app).
DELETE FROM announcements
WHERE liturgy_session_date IS NOT NULL;
