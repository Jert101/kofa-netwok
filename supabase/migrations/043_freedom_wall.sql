-- 043_freedom_wall.sql
--
-- A wall where the whole ministry can say something, anonymously.
--
-- --------------------------------------------------------------------------------------
-- Why two tables
--
-- The feature is "anonymous, except the super admin can tell who wrote it". Almost every way of
-- building that leaks, and the leak is quiet enough to go unnoticed for months:
--
--   - a `member_id` column on the post row. RLS is row-level, so anybody who may read a row may
--     read every column of it. Hiding the field in the UI is a promise, not a rule: the browser has
--     the whole payload, and so does anybody who opens devtools.
--   - an audit row per post. The audit page is admin-visible, and an audit row records the actor's
--     name. That is a de-anonymisation ledger wearing a compliance costume.
--
-- So the identity is not on the post at all. `freedom_wall_posts` is the wall: text, time, and the
-- moderation fields. `freedom_wall_authors` maps each post to the person who wrote it, and only the
-- super admin route ever reads it. A leak then needs a code change in the server, not a forgotten
-- `select`.
--
-- --------------------------------------------------------------------------------------
-- Row-level security is enabled with no policies on purpose
--
-- Every read and write in this application goes through the service role, which bypasses RLS, so a
-- policy here would document an intention nothing enforces. What it *does* enforce is the negative
-- case: with RLS on and no policy matching, `anon` and `authenticated` get nothing from PostgREST.
-- The anon key ships in the browser bundle, so without this a crafted request could read the author
-- table directly and skip the application entirely.
--
-- --------------------------------------------------------------------------------------
-- One function, so a post can never be unattributed
--
-- Two inserts from the route would leave a post with no author row whenever the second failed, and a
-- post the super admin cannot trace is the one failure this feature must not have. Doing both in
-- one function makes it one transaction. `REVOKE ALL ... FROM PUBLIC` keeps it to the service role,
-- so the function is not a second, unguarded door into the author table.
--
-- --------------------------------------------------------------------------------------
-- What is deliberately not here
--
-- No `edited_at` and no edit. A post is a thing someone said; letting it change underneath the
-- wall would make the feed a record of something nobody said. `hidden_at` is the moderator's tool,
-- and a hidden post is still stored and still attributable -- nothing is destroyed, so a mistaken
-- hiding is reversible.

CREATE TABLE IF NOT EXISTS freedom_wall_posts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set by the super admin. NULL means the post is on the wall.
  hidden_at  timestamptz,
  hidden_by  uuid,
  hidden_reason text,

  CONSTRAINT freedom_wall_posts_body
    CHECK (btrim(body) <> '' AND char_length(body) <= 1000)
);

CREATE INDEX IF NOT EXISTS freedom_wall_posts_recent
  ON freedom_wall_posts (created_at DESC);

COMMENT ON TABLE freedom_wall_posts IS
  'The Freedom Wall. Deliberately carries no author column: who wrote a post lives in freedom_wall_authors, which the public feed never reads.';

CREATE TABLE IF NOT EXISTS freedom_wall_authors (
  post_id     uuid PRIMARY KEY REFERENCES freedom_wall_posts(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: a member leaving the parish must not silently delete the record of what
  -- they said, and the name below is a snapshot taken at posting time so it survives that.
  member_id   uuid REFERENCES members(id) ON DELETE SET NULL,
  -- The name as it stood when the post was written. A member can be renamed or removed later, and
  -- "who was this" should still have an answer then.
  member_name text NOT NULL,
  role        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS freedom_wall_authors_member
  ON freedom_wall_authors (member_id, created_at DESC);

COMMENT ON TABLE freedom_wall_authors IS
  'Who wrote each Freedom Wall post. Read only by the super admin route. RLS is enabled with no policies, so anon and authenticated keys cannot read it; the service role bypasses RLS.';

ALTER TABLE freedom_wall_posts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE freedom_wall_authors ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION create_freedom_wall_post(
  p_body        text,
  p_member_id   uuid,
  p_member_name text,
  p_role        text
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO freedom_wall_posts (body)
  VALUES (p_body)
  RETURNING id INTO v_id;

  INSERT INTO freedom_wall_authors (post_id, member_id, member_name, role)
  VALUES (v_id, p_member_id, p_member_name, p_role);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION create_freedom_wall_post(text, uuid, text, text) FROM PUBLIC;
