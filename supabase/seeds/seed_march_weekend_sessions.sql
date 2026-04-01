-- March weekend session seeder (PostgreSQL / Supabase SQL editor)
-- Pattern: each Saturday → Anticipated Mass; each Sunday → First through Fourth Mass.
-- Idempotent marker: notes = 'SEED_MARCH_WEEKEND'
-- Change the year in seed_year below if needed.

DO $$
DECLARE
  seed_year int := 2026;
  d date;
  m_anticipated uuid;
  m_first uuid;
  m_second uuid;
  m_third uuid;
  m_fourth uuid;
  dow int;
BEGIN
  INSERT INTO masses (name, default_sunday, is_active)
  SELECT 'Anticipated Mass', false, true
  WHERE NOT EXISTS (SELECT 1 FROM masses WHERE name = 'Anticipated Mass');
  INSERT INTO masses (name, default_sunday, is_active)
  SELECT 'First Mass', false, true
  WHERE NOT EXISTS (SELECT 1 FROM masses WHERE name = 'First Mass');
  INSERT INTO masses (name, default_sunday, is_active)
  SELECT 'Second Mass', false, true
  WHERE NOT EXISTS (SELECT 1 FROM masses WHERE name = 'Second Mass');
  INSERT INTO masses (name, default_sunday, is_active)
  SELECT 'Third Mass', false, true
  WHERE NOT EXISTS (SELECT 1 FROM masses WHERE name = 'Third Mass');
  INSERT INTO masses (name, default_sunday, is_active)
  SELECT 'Fourth Mass', false, true
  WHERE NOT EXISTS (SELECT 1 FROM masses WHERE name = 'Fourth Mass');

  SELECT id INTO m_anticipated FROM masses WHERE name = 'Anticipated Mass' LIMIT 1;
  SELECT id INTO m_first FROM masses WHERE name = 'First Mass' LIMIT 1;
  SELECT id INTO m_second FROM masses WHERE name = 'Second Mass' LIMIT 1;
  SELECT id INTO m_third FROM masses WHERE name = 'Third Mass' LIMIT 1;
  SELECT id INTO m_fourth FROM masses WHERE name = 'Fourth Mass' LIMIT 1;

  DELETE FROM attendance_sessions
  WHERE notes = 'SEED_MARCH_WEEKEND'
    AND session_date >= make_date(seed_year, 3, 1)
    AND session_date <= make_date(seed_year, 3, 31);

  FOR d IN
    SELECT generate_series(make_date(seed_year, 3, 1), make_date(seed_year, 3, 31), interval '1 day')::date
  LOOP
    dow := EXTRACT(DOW FROM d)::int;
    IF dow = 6 THEN
      INSERT INTO attendance_sessions (session_date, mass_id, notes)
      VALUES (d, m_anticipated, 'SEED_MARCH_WEEKEND');
    ELSIF dow = 0 THEN
      INSERT INTO attendance_sessions (session_date, mass_id, notes) VALUES
        (d, m_first, 'SEED_MARCH_WEEKEND'),
        (d, m_second, 'SEED_MARCH_WEEKEND'),
        (d, m_third, 'SEED_MARCH_WEEKEND'),
        (d, m_fourth, 'SEED_MARCH_WEEKEND');
    END IF;
  END LOOP;
END $$;
