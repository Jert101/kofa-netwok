-- 040_ministry_content.sql
--
-- The three remaining content sections of the public landing page: the roles servers are trained into,
-- the timeline of the ministry's history, and the saints who are its patrons.
--
-- These arrived as part of a redesign of `/`. Before this they did not exist anywhere -- not as data and
-- not as markup -- and the question was whether they should be written into the page or made editable.
-- Editable, for the same reason the priest and the council are (see 038): a parish's roles, its
-- milestones and its patrons are facts about that parish, they change when the parish decides they
-- change, and none of them should need a deploy to say something different.
--
-- Three tables rather than one, and not one `kind` column on a single table. The three lists have
-- genuinely different shapes -- a role has a description and an icon, a milestone has a year label and a
-- sentence, a patron has a name and an optional note -- and a single table would mean either three sets
-- of mostly-null columns or a `jsonb` blob that cannot be read in a `select` without knowing its shape.
--
-- --------------------------------------------------------------------------------------
-- Why these are not a lookup table
-- --------------------------------------------------------------------------------------
-- `position_label` in the liturgy tables lists what a server *does at a particular Mass*. These are what
-- the parish *teaches and publishes about* those duties -- the explanation a new server is given. They
-- are different things with different lifetimes, and joining them would tie the published description to
-- whichever Mass happened to be rostered last.
--
-- --------------------------------------------------------------------------------------
-- Seeding
-- --------------------------------------------------------------------------------------
-- Seeded with real content rather than left empty, because an empty section on a public page reads as a
-- broken page. The seed runs only when the table is empty, so re-running this migration against a
-- database the super admin has already filled in changes nothing -- which is the whole reason it is
-- written this way rather than with plain INSERTs.

-- --------------------------------------------------------------------------------------
-- Roles at the altar
-- --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ministry_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- A key from a fixed list the page maps to a drawn glyph, rather than an emoji stored as text.
  -- Emoji render differently on every platform, vary in colour, and can carry flags and skin tones
  -- nobody chose; a constrained key is checked once, drawn consistently, and cannot 404 into a box.
  icon text NOT NULL DEFAULT 'cross',
  sort_order int NOT NULL DEFAULT 0,
  -- Vacated rather than deleted, like every other list in this module: a role the parish stops training
  -- should keep its place in the order in case it comes back.
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ministry_roles IS
  'The roles servers are trained into, published on the landing page. Descriptive only -- what a server does, not when they are rostered.';

CREATE INDEX IF NOT EXISTS ministry_roles_active_sort
  ON ministry_roles (is_active, sort_order);

INSERT INTO ministry_roles (name, description, icon, sort_order)
SELECT v.name, v.description, v.icon, v.sort_order
FROM (VALUES
  ('Crucifer', 'Carries the processional cross and leads the entrance and exit procession.', 'cross', 1),
  ('Candle bearers', 'Acolytes who carry the candles in procession and at the Gospel.', 'candle', 2),
  ('Thurifer and boat bearer', 'Handle the incense: one swings the thurible, the other carries the boat.', 'censer', 3),
  ('Bell ringer', 'Rings the bell at the moments of the Mass that call for it.', 'bell', 4)
) AS v(name, description, icon, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM ministry_roles);

-- --------------------------------------------------------------------------------------
-- A short timeline
-- --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS history_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Text rather than a date. "c. 251" and "1962–65" are both facts about this ministry and neither is
  -- a timestamp; a date column would force a year into the first and lose the range in the second.
  year_label text NOT NULL,
  body text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE history_milestones IS
  'Milestones in the story of the ministry, published on the landing page in the order given.';

CREATE INDEX IF NOT EXISTS history_milestones_active_sort
  ON history_milestones (is_active, sort_order);

INSERT INTO history_milestones (year_label, body, sort_order)
SELECT v.year_label, v.body, v.sort_order
FROM (VALUES
  ('c. 251', 'Pope Cornelius mentions dozens of acolytes serving the Roman Church.', 1),
  ('1570', 'The Roman Missal standardizes the rites and the server''s role.', 2),
  ('1962–65', 'Vatican II encourages full, conscious and active participation, with the Mass in local languages.', 3),
  ('1972', 'Ministeria Quaedam establishes lector and acolyte as lay ministries.', 4),
  ('1983', 'Canon 230 allows lay persons to serve temporarily at the altar.', 5),
  ('1994', 'The Holy See clarifies that girls may serve at the discretion of the diocesan bishop.', 6),
  ('2021', 'Spiritus Domini opens the instituted ministries of lector and acolyte to women.', 7)
) AS v(year_label, body, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM history_milestones);

-- --------------------------------------------------------------------------------------
-- Patrons of servers
-- --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patron_saints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- One line, optional. "Patron of altar servers" is the usual thing to say about these; leaving it
  -- blank just centres the name, which is a legitimate card as well.
  note text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE patron_saints IS
  'Saints traditionally invoked by altar servers, published on the landing page.';

CREATE INDEX IF NOT EXISTS patron_saints_active_sort
  ON patron_saints (is_active, sort_order);

INSERT INTO patron_saints (name, note, sort_order)
SELECT v.name, v.note, v.sort_order
FROM (VALUES
  ('St. John Berchmans', '', 1),
  ('St. Tarcisius', '', 2),
  ('St. Dominic Savio', '', 3)
) AS v(name, note, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM patron_saints);

-- Same arrangement as 038: enabled RLS with no policies, reachable only through a route that calls
-- `requireRole`. A public table with no client policy cannot be read from a browser.
ALTER TABLE ministry_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE history_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE patron_saints ENABLE ROW LEVEL SECURITY;