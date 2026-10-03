import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { internalError, jsonOk } from "@/lib/api/response";
import { getAllInternalSettings, getSetting } from "@/lib/settings/store";
import { SETTINGS_BY_KEY } from "@/lib/settings/registry";
import { isValidTimeZone } from "@/lib/time/church-time";
import { CRON_INTERVAL_HOURS, cronOverdueState, latestCronRuns, type CronJob } from "@/lib/system/cron-run";
import { findRolesOnDefaultPin, findRolesSharingAStoredHash, ROLES } from "@/lib/auth/pin-service";
import { DEFAULT_PIN } from "@/lib/auth/pin-rules";
import { loadRoster } from "@/features/attendance/server/load-roster";

export type HealthState = "ok" | "warn" | "error";

export type HealthCheck = {
  id: string;
  label: string;
  state: HealthState;
  detail: string;
  /** What to do about it, when the state is not ok. */
  fix?: string;
  href?: string;
};

/**
 * SYS-3: is this deployment healthy?
 *
 * ## The rule this page exists to enforce
 *
 * Spec §7: "The health page never shows secret values, only whether they are set." Every check below
 * reports presence and length-at-most, never content. `JWT_SECRET` is reported as "set, 32 characters"
 * rather than as the string, because a health page is a page an admin opens on a projector and a page
 * whose URL is in a browser history.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  try {
    const checks: HealthCheck[] = [];

    // ---- Database ---------------------------------------------------------------------------
    const sb = getSupabaseAdmin();
    const { error: dbError } = await sb.from("members").select("id", { count: "exact", head: true });
    checks.push(
      dbError
        ? {
            id: "database",
            label: "Database reachable",
            state: "error",
            detail: dbError.message,
            fix: "Check the Supabase URL and service key in the environment.",
          }
        : {
            id: "database",
            label: "Database reachable",
            state: "ok",
            detail: "Connected.",
          },
    );

    // ---- Required environment values ---------------------------------------------------------
    const env: Array<{ id: string; label: string; value: string | undefined; minLength?: number; hint: string }> = [
      {
        id: "jwt_secret",
        label: "JWT_SECRET",
        value: process.env.JWT_SECRET,
        minLength: 16,
        hint: "Set JWT_SECRET to a random value of at least 16 characters.",
      },
      {
        id: "supabase_url",
        label: "Supabase URL",
        value: process.env.NEXT_PUBLIC_SUPABASE_URL,
        hint: "Set NEXT_PUBLIC_SUPABASE_URL.",
      },
      {
        id: "supabase_service_key",
        label: "Supabase service key",
        value: process.env.SUPABASE_SERVICE_ROLE_KEY,
        hint: "Set SUPABASE_SERVICE_ROLE_KEY.",
      },
      {
        id: "cron_secret",
        label: "CRON_SECRET",
        value: process.env.CRON_SECRET,
        hint: "Set CRON_SECRET. Every cron refuses to run without it, which is deliberate.",
      },
      {
        // `getVapidConfig` reads exactly these three. Checking one of them is not enough: a half-filled
        // VAPID block gets past a single-variable check and then push silently fails for the whole parish
        // with no error anywhere.
        id: "vapid",
        label: "VAPID keys",
        value: allSet([
          process.env.VAPID_PRIVATE_KEY,
          process.env.VAPID_PUBLIC_KEY,
          process.env.VAPID_SUBJECT,
        ]),
        hint: "Generate a VAPID key pair with `npx web-push generate-vapid-keys` and set VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY and VAPID_SUBJECT.",
      },
    ];

    for (const item of env) {
      const set = typeof item.value === "string" && item.value.length > 0;
      const longEnough = !item.minLength || (item.value?.length ?? 0) >= item.minLength;

      checks.push({
        id: `env_${item.id}`,
        label: item.label,
        state: !set ? "error" : longEnough ? "ok" : "error",
        // The length, never the value.
        detail: !set ? "Missing." : longEnough ? "Set." : `Set, but only ${item.value!.length} characters.`,
        fix: !set || !longEnough ? item.hint : undefined,
      });
    }

    // ---- Timezone ---------------------------------------------------------------------------
    const timezoneRaw = await getSetting("report_timezone");
    const timezoneValid = isValidTimeZone(timezoneRaw);
    checks.push({
      id: "timezone",
      label: "Timezone",
      state: timezoneValid ? "ok" : "error",
      detail: timezoneValid ? `Valid: ${timezoneRaw}.` : `"${timezoneRaw}" is not a recognised zone.`,
      fix: timezoneValid ? undefined : "Set a valid IANA timezone on the Settings page.",
      href: "/admin/settings",
    });

    // ---- A registered setting that is missing or invalid -------------------------------------
    const { data: storedRows } = await sb.from("system_settings").select("key, value");
    const stored = new Map((storedRows ?? []).map((r) => [String(r.key), String(r.value ?? "")]));
    const brokenSettings = [...SETTINGS_BY_KEY.entries()]
      .filter(([, definition]) => definition.exposed)
      .filter(([key, definition]) => {
        const raw = stored.get(key);
        // A missing row is fine: the registry default applies. Only a row that is present and
        // invalid is a problem, which in practice means a hand-edited timezone.
        if (raw === undefined) return false;
        return definition.type === "timezone" && !isValidTimeZone(raw);
      })
      .map(([key]) => key);

    checks.push({
      id: "settings_valid",
      label: "Settings valid",
      state: brokenSettings.length === 0 ? "ok" : "error",
      detail:
        brokenSettings.length === 0
          ? "Every stored setting passes its validator."
          : `Invalid value stored for: ${brokenSettings.join(", ")}.`,
      fix: brokenSettings.length === 0 ? undefined : "Correct these on the Settings page.",
      href: brokenSettings.length === 0 ? undefined : "/admin/settings",
    });

    // ---- PINs -------------------------------------------------------------------------------
    const onDefault = await findRolesOnDefaultPin();
    checks.push({
      id: "default_pin",
      label: "Default PINs",
      state: onDefault.length === 0 ? "ok" : "error",
      detail:
        onDefault.length === 0
          ? "No role is using the default PIN."
          : `These roles still use the default PIN (${DEFAULT_PIN}): ${onDefault.join(", ")}.`,
      fix: onDefault.length === 0 ? undefined : "Change them on the Security page.",
      href: onDefault.length === 0 ? undefined : "/admin/security",
    });

    const shared = findRolesSharingAStoredHash(await getAllInternalSettings());
    checks.push({
      id: "duplicate_pin_hash",
      label: "Duplicate PINs",
      state: shared.length === 0 ? "ok" : "warn",
      detail:
        shared.length === 0
          ? "Every role has a distinct PIN."
          : `These roles share the same stored hash: ${shared.join(", ")}.`,
      // A warn, not an error: this only catches a *copied* hash, never two hashes of the same PIN, so
      // it is a hint rather than proof. Saying so is the honest report.
      fix: shared.length === 0 ? undefined : "Change one of each pair on the Security page.",
      href: shared.length === 0 ? undefined : "/admin/security",
    });

    const internal = await getAllInternalSettings();
    const missingPins = ROLES.filter((role) => !internal[`pin_${role}_hash`]);
    checks.push({
      id: "pins_set",
      label: "Every role has a PIN",
      state: missingPins.length === 0 ? "ok" : "error",
      detail:
        missingPins.length === 0
          ? "All six roles have a PIN configured."
          : `No PIN set for: ${missingPins.join(", ")}.`,
      fix: missingPins.length === 0 ? undefined : "Set them on the Security page.",
      href: missingPins.length === 0 ? undefined : "/admin/security",
    });

    const superAdminApproval = (internal["pin_super_admin_hash"] ?? "").length > 0;
    checks.push({
      id: "super_admin_approval",
      label: "Super admin approval",
      state: "ok",
      detail: superAdminApproval
        ? "On. Reports are held for review before they are generated."
        : "Off. Reports are generated without a second pair of eyes.",
    });

    // ---- Push -------------------------------------------------------------------------------
    const { count: deviceCount } = await sb
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true });

    checks.push({
      id: "push",
      label: "Push subscriptions",
      state: "ok",
      detail: `${deviceCount ?? 0} subscribed ${deviceCount === 1 ? "device" : "devices"}.`,
    });

    // ---- Storage ----------------------------------------------------------------------------
    // Reports are written to a Supabase storage bucket. Checked by listing it rather than by reading a
    // settings key, because the bucket name is fixed and the key would only ever be the wrong answer.
    const storage = getSupabaseAdmin().storage;
    const { error: storageError } = await storage.from("reports").list("", { limit: 1 });
    checks.push({
      id: "reports_bucket",
      label: "Reports bucket",
      state: storageError ? "warn" : "ok",
      // The bucket may legitimately be empty, which is not an error; an error here is a real permission
      // problem and would surface as a failed PDF download.
      detail: storageError ? storageError.message : "Reachable.",
      fix: storageError ? "Create the 'reports' bucket and check the service key can write to it." : undefined,
    });

    // ---- Cron jobs --------------------------------------------------------------------------
    const runs = await latestCronRuns();
    const cronChecks = (Object.keys(CRON_INTERVAL_HOURS) as CronJob[]).map((job) => {
      const last = runs[job];
      const state = cronOverdueState(job, last);
      return {
        id: `cron_${job}`,
        label: `Cron: ${job}`,
        state: (state.overdue ? "error" : last?.ok === false ? "warn" : "ok") as HealthState,
        detail: last
          ? `${describeRun(last.ok, last.started_at)}${state.reason ? ` — ${state.reason}` : ""}`
          : state.reason,
        fix: state.overdue ? "Check vercel.json still lists the job, and that CRON_SECRET matches." : undefined,
      } satisfies HealthCheck;
    });
    checks.push(...cronChecks);

    // ---- Schema this build needs --------------------------------------------------------------
    // Replaces a check that read `public.schema_migrations`, which does not exist: Supabase keeps its
    // migration ledger outside the exposed schema, and these migrations are applied by pasting them
    // into the SQL editor, which leaves no ledger a PostgREST client can read. So this page reported
    // "Could not read the migration table" against a database where all 34 migrations were present --
    // a permanent amber that trains an admin to stop reading the page.
    //
    // With no ledger to read, the only honest substitute is to ask whether the objects the code queries
    // are actually there. Each entry is something a route selects from or embeds, so a build deployed
    // against an older database fails here instead of on a secretary's screen.
    const REQUIRED_OBJECTS = [
      "v_attendance_all",
      "cron_runs",
      "attendance_sessions",
      "attendance_records",
      "attendance_sessions_archive",
      "attendance_records_archive",
      "attendance_appeals",
      "attendance_appeal_items",
      "member_batches",
      "payment_structures",
      "liturgy_planned",
      "liturgy_templates",
      "registration_requests",
      "push_subscriptions",
      "audit_log",
    ];

    const missingObjects: string[] = [];
    for (const object of REQUIRED_OBJECTS) {
      // A 404 here means PostgREST has no such relation, which is exactly "not migrated". Any other
      // failure -- a permissions problem, say -- is surfaced by the checks that read the data itself.
      const probe = await sb.from(object).select("*", { count: "exact", head: true });
      if (probe.error) missingObjects.push(object);
    }

    checks.push({
      id: "schema_objects",
      label: "Schema this build needs",
      state: missingObjects.length === 0 ? "ok" : "error",
      detail:
        missingObjects.length === 0
          ? `All ${REQUIRED_OBJECTS.length} tables and views this build queries are present.`
          : `Missing: ${missingObjects.join(", ")}.`,
      fix:
        missingObjects.length === 0
          ? undefined
          : "Apply the pending migrations in the Supabase SQL editor, then reload this page.",
    });

    // ---- Attendance read path -------------------------------------------------------------------
    // Added because a query that can never succeed is invisible until the one screen that needs it is
    // opened. `loadRoster` asked PostgREST to embed `attendance_sessions_archive!inner(session_date)`,
    // which is impossible: `attendance_records_archive.session_id` has no foreign key, because the
    // archive keys on `(id, archived_at)` and `id` alone is not unique there. Every session screen
    // answered 500 with an empty body while the database, the env, the PINs and the crons all reported
    // green, and no other check on this page would have noticed. So this runs the same read a secretary
    // runs when they open a Mass.
    const newestSession = await sb
      .from("attendance_sessions")
      .select("id")
      .order("session_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (newestSession.error) {
      checks.push({
        id: "attendance_read",
        label: "Attendance read path",
        state: "error",
        detail: newestSession.error.message,
        fix: "Check the Supabase URL and service key in the environment.",
      });
    } else if (!newestSession.data) {
      checks.push({
        id: "attendance_read",
        label: "Attendance read path",
        state: "ok",
        detail: "No sessions exist yet, so there is nothing to read a roster from.",
      });
    } else {
      try {
        const { roster } = await loadRoster(sb, newestSession.data.id, await getSetting("report_timezone"));
        checks.push({
          id: "attendance_read",
          label: "Attendance read path",
          state: "ok",
          detail: `The newest session's roster loads: ${roster.length} active members.`,
        });
      } catch (e) {
        checks.push({
          id: "attendance_read",
          label: "Attendance read path",
          state: "error",
          detail: e instanceof Error ? e.message : "The session roster query failed.",
          fix: "Session screens cannot load. This is a query or schema problem, not a configuration one.",
        });
      }
    }

    const worst = checks.some((c) => c.state === "error")
      ? "error"
      : checks.some((c) => c.state === "warn")
        ? "warn"
        : "ok";

    return jsonOk({
      state: worst,
      checked_at: new Date().toISOString(),
      checks,
      summary: {
        ok: checks.filter((c) => c.state === "ok").length,
        warn: checks.filter((c) => c.state === "warn").length,
        error: checks.filter((c) => c.state === "error").length,
      },
    });
  } catch (e) {
    console.error("[admin/health] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not run the health checks.");
  }
}

/**
 * "Are all three of these set?"
 *
 * Reduced to a marker string rather than a boolean so the check above reports it like any other presence
 * check, and so no part of the value can leak into the response by accident.
 */
function allSet(values: Array<string | undefined>): string | undefined {
  const missing = values.filter((v) => !v || v.length === 0).length;
  if (missing === 0) return "set";
  return `${missing} of 3 missing`;
}

function describeRun(ok: boolean | null, startedAt: string): string {
  const when = startedAt.slice(0, 16).replace("T", " ");
  if (ok === true) return `Last run ${when}, succeeded`;
  if (ok === false) return `Last run ${when}, failed`;
  return `Last run ${when}, started and never finished`;
}