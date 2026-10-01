import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { jsonOk, rateLimited } from "@/lib/api/response";
import { checkSubmitAllowed, recordAttempt } from "@/lib/auth/throttle";
import { getClientIp } from "@/lib/auth/ip-hash";
import {
  describeReferenceCodeProblem,
  normalizeReferenceCodeInput,
} from "@/lib/registrations/reference-code";

export const dynamic = "force-dynamic";

/**
 * Public status lookup by reference code (module 03, REG-3).
 *
 * A wrong code and a code that does not exist return the same message, so this
 * cannot be used to test which codes are real.
 */

export type RegisterStatus = {
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  reviewedAt: string | null;
  rejectReason: string | null;
};

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const raw = new URL(req.url).searchParams.get("code") ?? "";

  const code = normalizeReferenceCodeInput(raw);
  const problem = describeReferenceCodeProblem(code);

  // A malformed code can never match a row, so it is answered without touching the
  // database and without counting against the throttle. A well-formed code that
  // simply does not exist does count, which is what limits code guessing.
  if (problem === "length") {
    return jsonOk({ found: false });
  }

  const throttle = await checkSubmitAllowed("register", ip);
  if (throttle.blocked) {
    await recordAttempt("register", ip, false);
    const minutes = Math.max(1, Math.ceil(throttle.retryAfterSeconds / 60));
    return rateLimited(
      `Too many lookups. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }

  if (problem !== null) {
    // Ambiguous or out-of-alphabet characters can never be a real code.
    await recordAttempt("register", ip, false);
    return jsonOk({ found: false });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("registration_requests")
    .select("status, created_at, reviewed_at, reject_reason, reference_code")
    .eq("reference_code", code)
    .maybeSingle();

  if (error) {
    console.error("[register/status] query failed:", error.message);
    return jsonOk({ found: false });
  }

  if (!data) {
    await recordAttempt("register", ip, false);
    return jsonOk({ found: false });
  }

  await recordAttempt("register", ip, true);
  return jsonOk({
    found: true,
    result: {
      status: data.status as RegisterStatus["status"],
      submittedAt: data.created_at as string,
      reviewedAt: (data.reviewed_at as string | null) ?? null,
      rejectReason: (data.reject_reason as string | null) ?? null,
    } satisfies RegisterStatus,
  });
}
