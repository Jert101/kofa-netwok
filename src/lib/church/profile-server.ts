import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings/store";
import { isUndeployedSchemaError, migrationMessage } from "@/lib/supabase/migration-error";
import { MINISTRY_COLUMNS, MINISTRY_KINDS, MINISTRY_TABLE, type MinistryKind } from "./ministry";
import type { ChurchProfile, Milestone, Patron, Role } from "./profile";

/**
 * Read the parish profile exactly as it may be published.
 *
 * ## Why this exists rather than the landing page calling `/api/church`
 *
 * It did, and it failed on every request. A server component has no request to hand `fetch`, so the
 * absolute URL had to be reconstructed from `NEXT_PUBLIC_APP_URL`, `VERCEL_URL`, or `localhost` — and
 * whichever of those the deployment happened to supply decided whether the front door showed the
 * parish's own content or quietly left it out. It left it out. The priest's name, the history and the
 * council were all saved, correct, and being served correctly by `/api/church` the whole time; the
 * landing page was fetching them over HTTP and getting nothing back, and `fetchChurchProfile` returned
 * null for every failure, so the page rendered perfectly and silently without a single word of it.
 *
 * Every reason that can go wrong there is a reason to not be doing it. The env var can be absent or
 * stale. `VERCEL_URL` is the deployment-specific host, not the custom domain, and is not present
 * everywhere a build runs. The call is a full extra network round trip -- TLS, a cold start, a function
 * invocation -- to read two small tables that this process can already read. And a self-request that
 * fails for any reason at all produces no error worth acting on, because the page has no way to tell
 * "this deployment has no content" from "this deployment cannot reach itself".
 *
 * ## What this keeps
 *
 * The property the loopback was for: one place decides what a signed-out stranger may be shown, so the
 * page and the route cannot drift apart. Sharing a function does that more strictly than sharing an HTTP
 * endpoint did -- before, the page agreed with the route only if the route answered; now they cannot
 * disagree at all, because there is one body of code rather than one body of code plus a network call
 * that has to reach it.
 */

/** The migration that creates the tables this reads, named in the failure so it can be acted on. */
const CHURCH_MIGRATION = "038_church_ministry.sql";

export type PublicProfileResult =
  | { ok: true; profile: ChurchProfile }
  | { ok: false; reason: string };

export async function readPublicChurchProfile(): Promise<PublicProfileResult> {
  const sb = getSupabaseAdmin();

  const [{ data: profile, error: pErr }, { data: members, error: mErr }, churchName] = await Promise.all([
    sb
      .from("church_profile")
      .select("priest_name, headline, about, photo_url, updated_at")
      .limit(1)
      .maybeSingle(),
    sb
      .from("council_members")
      .select("id, name, office, bio, photo_url, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    // A bad or missing setting must not take the front door down with it; the registry default is a
    // perfectly good parish name and this is the page a stranger lands on.
    getSetting("church_name").catch(() => "Knights of the Altar"),
  ]);

  const rows = await readMinistryLists(sb);

  // A database where the migration has not been applied answers both reads with `relation ... does not
  // exist`. That is the single most likely thing to be wrong after a deploy, so it is named -- and the
  // landing page logs it rather than swallowing it, which is what made this take a day to find.
  if (pErr || mErr) {
    const err = pErr ?? mErr;
    if (isUndeployedSchemaError(err)) {
      return { ok: false, reason: migrationMessage(CHURCH_MIGRATION) };
    }
    return { ok: false, reason: err?.message ?? "The parish profile could not be read." };
  }

  return {
    ok: true,
    profile: {
      parish_name: churchName,
      priest_name: profile?.priest_name ?? null,
      headline: profile?.headline ?? null,
      about: profile?.about ?? null,
      photo_url: profile?.photo_url ?? null,
      updated_at: profile?.updated_at ?? null,
      council: members ?? [],
      roles: rows.role as Role[],
      milestones: rows.milestone as Milestone[],
      patrons: rows.patron as Patron[],
    },
  };
}

/**
 * The three editable lists, in one pass.
 *
 * Read together rather than in three awaited calls because they are three more round trips to the same
 * database for content that always appears together on the page.
 *
 * A list that cannot be read yields an empty list rather than failing the whole profile. A parish whose
 * timeline table has not been created yet should still get its priest's name and its council on the
 * front door; the missing section is worth a log line, not a blank page.
 */
async function readMinistryLists(
  sb: ReturnType<typeof getSupabaseAdmin>,
): Promise<Record<MinistryKind, unknown[]>> {
  const out = {} as Record<MinistryKind, unknown[]>;
  await Promise.all(
    MINISTRY_KINDS.map(async (kind) => {
      const { data, error } = await sb
        .from(MINISTRY_TABLE[kind])
        .select(MINISTRY_COLUMNS[kind])
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) {
        console.error(`[church] the "${kind}" list could not be read:`, error.message);
        out[kind] = [];
        return;
      }
      out[kind] = data ?? [];
    }),
  );
  return out;
}