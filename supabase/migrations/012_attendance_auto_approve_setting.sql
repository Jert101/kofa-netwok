INSERT INTO system_settings (key, value)
VALUES ('attendance_auto_approve_appeals', 'false')
ON CONFLICT (key) DO NOTHING;
