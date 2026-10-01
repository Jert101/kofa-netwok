import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  badRequest,
  internalError,
  jsonError,
  jsonOk,
  validationFailed,
  zodFields,
} from "@/lib/api/response";
import {
  normalizeRegisterInput,
  registerSchema,
} from "@/features/registrations/schemas";
import { findPossibleDuplicate } from "@/features/registrations/server/duplicates";
import { checkSubmitAllowed, recordAttempt } from "@/lib/auth/throttle";
import { getClientIp } from "@/lib/auth/ip-hash";
import { REGISTER_MIN_FILL_MS } from "@/lib/auth/throttle-rules";
import { generateReferenceCode } from "@/lib/registrations/generate";

/** Honeypot: a real person never sees or fills this. */
const HONEYPOT_FIELD = "company";
const FORM_LOADED_AT_FIELD = "formLoadedAt";

/** Postgres unique violation on registration_requests_reference_code. */
const UNIQUE_VIOLATION = "23505";

/** How many times to retry a reference-code clash before giving up. */
const CODE_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Could not read the request.");
  }

  if (typeof json !== "object" || json === null) {
    return badRequest("Could not read the request.");
  }

  const body = json as Record<string, unknown>;
  const ip = getClientIp(req.headers);

  // AUTH-2: a filled honeypot is a bot. Report success so it learns nothing,
  // and do not write anything.
  if (typeof body[HONEYPOT_FIELD] === "string" && body[HONEYPOT_FIELD].trim() !== "") {
    return jsonOk({ received: true });
  }

  const loadedAt = Number(body[FORM_LOADED_AT_FIELD]);
  if (!Number.isFinite(loadedAt) || Date.now() - loadedAt < REGISTER_MIN_FILL_MS) {
    return jsonError("RATE_LIMITED", "Please wait a moment and try again.", { status: 429 });
  }

  const throttle = await checkSubmitAllowed("register", ip);
  if (throttle.blocked) {
    const minutes = Math.max(1, Math.ceil(throttle.retryAfterSeconds / 60));
    return jsonError("RATE_LIMITED", `Too many submissions. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, {
      status: 429,
      headers: { "Retry-After": String(throttle.retryAfterSeconds) },
    });
  }

  const parsed = registerSchema.safeParse(normalizeRegisterInput(body));
  if (!parsed.success) {
    return validationFailed("Check the form and try again.", zodFields(parsed.error));
  }

  const first_name = parsed.data.first_name;
  const last_name = parsed.data.last_name;
  const middle_initial = parsed.data.middle_initial || null;
  const batch = parsed.data.batch || null;
  const { date_of_birth, gender, contact_number } = parsed.data;

  const sb = getSupabaseAdmin();

  // REG-2: a name that already exists is recorded, not refused. Telling the
  // applicant would confirm whether that person is a member.
  const duplicate = await findPossibleDuplicate({
    firstName: first_name,
    middleInitial: middle_initial,
    lastName: last_name,
  });

  // REG-3: the applicant gets a code so they can check the outcome themselves.
  // A clash with an existing code is astronomically unlikely but the unique index
  // would reject the whole insert, so retry rather than lose the application.
  let referenceCode = generateReferenceCode();
  let inserted = false;
  let lastError: { code?: string; message: string } | null = null;

  for (let attempt = 0; attempt < CODE_ATTEMPTS && !inserted; attempt += 1) {
    if (attempt > 0) referenceCode = generateReferenceCode();

    const { error } = await sb.from("registration_requests").insert({
      first_name,
      last_name,
      middle_initial,
      date_of_birth,
      gender,
      contact_number,
      batch,
      reference_code: referenceCode,
      possible_duplicate_member_id: duplicate.memberId,
    });

    if (!error) {
      inserted = true;
      break;
    }

    lastError = { code: error.code, message: error.message };
    if (error.code !== UNIQUE_VIOLATION) break;
    console.warn(`[register] reference code clash on attempt ${attempt + 1}, retrying`);
  }

  if (!inserted) {
    console.error("[register] insert failed", lastError);
    await recordAttempt("register", ip, false);
    return internalError("Could not save the application. Please try again.");
  }

  await recordAttempt("register", ip, true);
  return jsonOk({ received: true, reference_code: referenceCode });
}

