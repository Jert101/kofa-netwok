import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ipHashFor } from "./ip-hash";
import {
  evaluateGlobalThrottle,
  evaluateThrottle,
  THROTTLE_RULES,
  type ThrottleDecision,
  type ThrottleKind,
} from "./throttle-rules";

export type { ThrottleDecision, ThrottleKind } from "./throttle-rules";

function sinceIso(windowMs: number, now: number): string {
  return new Date(now - windowMs).toISOString();
}

async function failureTimes(
  ipHash: string,
  kind: ThrottleKind,
  windowMs: number,
  now: number,
): Promise<number[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("login_attempts")
    .select("attempted_at")
    .eq("ip_hash", ipHash)
    .eq("kind", kind)
    .eq("success", false)
    .gte("attempted_at", sinceIso(windowMs, now));

  if (error) {
    // Fail open: a throttling table problem must not lock everyone out.
    console.error("[throttle] could not read login_attempts:", error.message);
    return [];
  }
  return (data ?? []).map((r) => new Date(r.attempted_at as string).getTime());
}

/** Records one attempt. Failures drive the limits; successes are kept for the trail. */
export async function recordAttempt(
  kind: ThrottleKind,
  ip: string | null,
  success: boolean,
): Promise<void> {
  const ipHash = ipHashFor(ip);
  if (!ipHash) return;
  try {
    const { error } = await getSupabaseAdmin().from("login_attempts").insert({
      ip_hash: ipHash,
      kind,
      success,
    });
    if (error) console.error("[throttle] could not record attempt:", error.message);
  } catch (e) {
    console.error("[throttle] could not record attempt:", e instanceof Error ? e.message : e);
  }
}

export async function checkLoginAllowed(ip: string | null, now = Date.now()): Promise<ThrottleDecision> {
  const rule = THROTTLE_RULES.login;
  const ipHash = ipHashFor(ip);

  let globalDelayMs = 0;
  if (ipHash) {
    const { data, error } = await getSupabaseAdmin()
      .from("login_attempts")
      .select("attempted_at")
      .eq("kind", "login")
      .eq("success", false)
      .gte("attempted_at", sinceIso(rule.windowMs, now));
    if (error) {
      console.error("[throttle] could not read global login_attempts:", error.message);
    } else {
      globalDelayMs = evaluateGlobalThrottle(
        (data ?? []).map((r) => new Date(r.attempted_at as string).getTime()),
        now,
      );
    }
  }

  if (!ipHash) return { blocked: false, globalDelayMs };

  const decision = evaluateThrottle(await failureTimes(ipHash, "login", rule.windowMs, now), rule, now);
  return { ...decision, globalDelayMs };
}

export async function checkSubmitAllowed(
  kind: Exclude<ThrottleKind, "login">,
  ip: string | null,
  now = Date.now(),
): Promise<ThrottleDecision> {
  const ipHash = ipHashFor(ip);
  if (!ipHash) return { blocked: false, globalDelayMs: 0 };
  const rule = THROTTLE_RULES[kind];
  return evaluateThrottle(await failureTimes(ipHash, kind, rule.windowMs, now), rule, now);
}

/** Admin escape hatch for a shared church IP: forgets failed attempts. */
export async function clearLoginBlocks(): Promise<number> {
  const { error, count } = await getSupabaseAdmin()
    .from("login_attempts")
    .delete({ count: "exact" })
    .eq("kind", "login")
    .eq("success", false);
  if (error) throw error;
  return count ?? 0;
}
