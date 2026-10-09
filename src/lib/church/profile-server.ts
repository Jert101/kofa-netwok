import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings/store";
import { isUndeployedSchemaError, migrationMessage } from "@/lib/supabase/migration-error";
import type { ChurchProfile } from "./profile";

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
    },
  };
}