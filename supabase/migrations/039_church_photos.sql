-- 039_church_photos.sql
--
-- Photographs for the parish profile and the council, shown on the public landing page.
--
-- --------------------------------------------------------------------------------------
-- Why a bucket and not the existing `reports` one
-- --------------------------------------------------------------------------------------
-- Reports hold attendance records and are private. These are pictures of the priest and of council
-- members, on a page anyone can open -- so they live in their own **public** bucket and the URL goes
-- straight into an <img>. Sharing the private bucket would mean an API route per image and a
-- signed URL for every render, for content that is public anyway.
--
-- "Public" here means readable by anyone holding the URL, which is the intent. The objects are named
-- by uuid and never guessable, and the bucket holds no record of anybody who is not on the council.
-- The service role bypasses RLS, so no storage policies are needed for writes -- the API route is the
-- only door, the same arrangement church_profile and council_members use.
--
-- --------------------------------------------------------------------------------------
-- The column stores a URL, not a key
-- --------------------------------------------------------------------------------------
-- The table is read by the landing page, which renders an <img src>. A key would have to be turned
-- into a URL on every read, and a stored URL keeps the bucket name out of the renderer. The cost is
-- that the bucket name appears in the data, so a bucket rename would need a data migration -- a
-- migration that changes a bucket name anyway.
--
-- Empty is null, not "": a member with no photograph renders their initials, and an empty string would
-- render a broken image instead.

ALTER TABLE church_profile
  ADD COLUMN IF NOT EXISTS photo_url text;

ALTER TABLE council_members
  ADD COLUMN IF NOT EXISTS photo_url text;

COMMENT ON COLUMN church_profile.photo_url IS
  'Public URL of the parish priest''s photograph. Null renders initials derived from priest_name.';
COMMENT ON COLUMN council_members.photo_url IS
  'Public URL of this member''s photograph. Null renders initials derived from name. Uploads are limited to 2 MB.';

-- Created here rather than from a route so the bucket exists the moment the migration is applied. An
-- upload endpoint that creates its own bucket on first use would work too, and be the first thing to
-- fail on a database where the service key cannot create buckets.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('church-photos', 'church-photos', true, 2097152)
ON CONFLICT (id) DO NOTHING;

-- 2 MB, matching the bucket's own limit above. The application enforces it too, with a message the
-- officer can act on; this is the backstop for anything that reaches the bucket by another path.