import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  internalError,
  jsonOk,
  validationFailed,
  zodFields,
} from "@/lib/api/response";
import {
  buildPendingTwinMap,
  fetchMemberNames,
  fetchPendingNamePairs,
} from "@/features/registrations/server/duplicates";
import { composeFullName } from "@/lib/members/normalize-name";

const querySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

const SELECT = `
  id, first_name, last_name, middle_initial, date_of_birth, gender,
  contact_number, batch, status, reference_code, reject_reason,
  created_at, reviewed_at, possible_duplicate_member_id, approved_member_id
`;

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    page_size: url.searchParams.get("page_size") ?? undefined,
  });

  if (!parsed.success) {
    return validationFailed("Check the filters and try again.", zodFields(parsed.error));
  }

  const { status, page, page_size } = parsed.data;
  const sb = getSupabaseAdmin();
  const from = (page - 1) * page_size;

  // Tab counts are three parallel head counts rather than one grouped aggregate:
  // supabase-js has no helper for a per-group count, and the shape of that
  // response is not something to depend on for something the admin relies on.
  const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
    sb.from("registration_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("registration_requests").select("id", { count: "exact", head: true }).eq("status", "approved"),
    sb.from("registration_requests").select("id", { count: "exact", head: true }).eq("status", "rejected"),
  ]);

  if (pendingCount.error || approvedCount.error || rejectedCount.error) {
    return internalError("Could not load the application counts.");
  }

  const counts = {
    pending: pendingCount.count ?? 0,
    approved: approvedCount.count ?? 0,
    rejected: rejectedCount.count ?? 0,
  };

  let query = sb.from("registration_requests").select(SELECT, { count: "exact" });
  if (status !== "all") query = query.eq("status", status);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + page_size - 1);

  if (error) {
    return internalError("Could not load the applications.");
  }

  type Row = Record<string, unknown> & { id: string; fullName: string };

  const withNames: Row[] = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      ...r,
      id: r.id as string,
      fullName: composeFullName({
        firstName: r.first_name as string,
        middleInitial: r.middle_initial as string | null,
        lastName: r.last_name as string,
      }),
    };
  });

  // A match against an active member is stored in a column but its *name* is not,
  // and a pending-vs-pending match is not stored at all. Both are resolved here so
  // the badge can name who the applicant might be, wherever the twin sits.
  const memberIds = withNames
    .map((r) => r.possible_duplicate_member_id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const [memberNames, allPending] = await Promise.all([
    fetchMemberNames(memberIds),
    fetchPendingNamePairs(),
  ]);

  // Only a still-pending row can be a twin of a pending application; an approved
  // row that matches one is a different situation and the member column covers it.
  const pendingPage = withNames.filter((r) => r.status === "pending");
  const twins = buildPendingTwinMap(pendingPage, allPending);

  const requests = withNames.map(({ fullName, ...rest }) => {
    const memberName = rest.possible_duplicate_member_id
      ? (memberNames.get(rest.possible_duplicate_member_id as string) ?? null)
      : null;
    const twin = twins.get(rest.id as string);
    return {
      ...rest,
      full_name: fullName,
      // The member match wins: it is the one that blocks an approval.
      possible_duplicate_name: memberName ?? twin?.fullName ?? null,
      possible_duplicate_pending: !rest.possible_duplicate_member_id && twin !== undefined,
    };
  });

  return jsonOk({ requests, counts, page, page_size, total: count ?? requests.length });
}
