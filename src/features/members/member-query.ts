/**
 * One description of "which members am I looking at", shared by the directory
 * page, the CSV export and the PDF (module 03, MEM-1 / MEM-7).
 *
 * The three used to filter separately, so a PDF could quietly disagree with the
 * list the admin was looking at when they clicked it.
 */

import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeName } from "@/lib/members/normalize-name";

export const MEMBER_SORTS = ["name", "batch", "date_of_birth"] as const;
export type MemberSort = (typeof MEMBER_SORTS)[number];

export const MEMBER_STATUSES = ["active", "inactive", "all"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const memberQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  batch: z.string().trim().max(4).default(""),
  gender: z.enum(["male", "female"]).or(z.literal("")).default(""),
  status: z.enum(MEMBER_STATUSES).default("active"),
  birth_month: z
    .string()
    .trim()
    .regex(/^([1-9]|1[0-2])$/, "Use a month number from 1 to 12.")
    .or(z.literal(""))
    .default(""),
  sort: z.enum(MEMBER_SORTS).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type MemberQuery = z.infer<typeof memberQuerySchema>;

/**
 * Reads the shared params from a URL.
 *
 * `parseMemberQuery` is for internal callers that already trust their input; a
 * route should use `safeParseMemberQuery` and turn the failure into a 400 instead
 * of letting a ZodError surface as a 500.
 */
export function parseMemberQuery(params: URLSearchParams): MemberQuery {
  return memberQuerySchema.parse(rawParams(params));
}

export function safeParseMemberQuery(params: URLSearchParams) {
  return memberQuerySchema.safeParse(rawParams(params));
}

function rawParams(params: URLSearchParams) {
  return {
    q: params.get("q") ?? undefined,
    batch: params.get("batch") ?? undefined,
    gender: params.get("gender") ?? undefined,
    status: params.get("status") ?? undefined,
    birth_month: params.get("birth_month") ?? undefined,
    sort: params.get("sort") ?? undefined,
    dir: params.get("dir") ?? undefined,
    page: params.get("page") ?? undefined,
    page_size: params.get("pageSize") ?? params.get("page_size") ?? undefined,
  };
}

/**
 * The month of a birth date as stored, or null.
 * Kept in one place so the filter and the badge count cannot disagree.
 */
export function birthMonth(dateOfBirth: string | null | undefined): string | null {
  if (!dateOfBirth || dateOfBirth.length < 7) return null;
  const month = dateOfBirth.slice(5, 7);
  return /^(0[1-9]|1[0-2])$/.test(month) ? month : null;
}

export type MemberRow = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  gender: string | null;
  contact_number: string | null;
  batch: string | null;
  is_active: boolean;
  deactivated_at: string | null;
  deactivation_reason: string | null;
  created_at: string;
};

export type MemberListResult = {
  members: MemberRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Count of members in the same filter but without the birth month, for the tab badge. */
  totalWithoutBirthMonth: number;
};

const SELECT = `
  id, full_name, date_of_birth, gender, contact_number, batch,
  is_active, deactivated_at, deactivation_reason, created_at
`;

/**
 * Birth month has no column, so it cannot be pushed into the database. Rows are
 * read then filtered here, which is why the page size is capped at 100: a filter
 * combination that matches a lot of people still only pulls one page.
 */
function applyBirthMonth(rows: MemberRow[], month: string): MemberRow[] {
  if (!month) return rows;
  const wanted = month.padStart(2, "0");
  return rows.filter((row) => birthMonth(row.date_of_birth) === wanted);
}

/**
 * Free-text search over name, contact number and batch.
 *
 * Exported for its tests, because the interesting failures here are silent: a
 * match that is too loose does not look like an error, it just looks like a list
 * that ignored what you typed.
 *
 * The digit stripping on the contact number is the fiddly part. Contact numbers
 * are stored however the person typed them, so "0917 123 4567" has to match
 * "09171234567". But stripping the digits out of a *name* search leaves an empty
 * string, and every string contains an empty string, which quietly turns a search
 * for "Jerson" into "everyone with a contact number". Hence the explicit guard.
 *
 * `searchContactNumber` is the caller's decision, not this function's. A viewer who may not read the
 * number must not be able to search by it either: matching against a column you are not allowed to see
 * is an oracle, and one that hands the number over a digit at a time. See `member-visibility.ts`.
 */
export function applySearch(
  rows: MemberRow[],
  q: string,
  { searchContactNumber = true }: { searchContactNumber?: boolean } = {},
): MemberRow[] {
  const needle = normalizeName(q);
  if (!needle) return rows;

  const digits = searchContactNumber ? needle.replace(/\D/g, "") : "";

  return rows.filter((row) => {
    if (normalizeName(row.full_name).includes(needle)) return true;
    if (digits) {
      const contact = (row.contact_number ?? "").replace(/\D/g, "");
      if (contact.includes(digits)) return true;
    }
    return row.batch !== null && row.batch.includes(needle);
  });
}

function compare(a: MemberRow, b: MemberRow, sort: MemberSort, dir: "asc" | "desc"): number {
  const sign = dir === "asc" ? 1 : -1;
  switch (sort) {
    case "batch": {
      // Members with no batch sort last whichever way the arrow points, which is
      // what an admin scanning a batch list expects.
      const av = a.batch ?? "";
      const bv = b.batch ?? "";
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      return av.localeCompare(bv) * sign;
    }
    case "date_of_birth": {
      const av = a.date_of_birth ?? "";
      const bv = b.date_of_birth ?? "";
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      return av.localeCompare(bv) * sign;
    }
    case "name":
    default:
      return a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" }) * sign;
  }
}

/**
 * Runs the filter.
 *
 * The database handles status, batch, gender, ordering and paging. Birth month and
 * text search are done here because there is no column to match on, which is why
 * those two run over the whole filtered set rather than one page of it.
 */
export async function fetchMembers(
  query: MemberQuery,
  search: { searchContactNumber?: boolean } = {},
): Promise<MemberListResult> {
  const sb = getSupabaseAdmin();
  // No `count: "exact"` here: the real total depends on the search, which only
  // runs in this function, so a database count would be a second number that can
  // disagree with the page.
  let q = sb.from("members").select(SELECT);

  if (query.status === "active") q = q.eq("is_active", true);
  else if (query.status === "inactive") q = q.eq("is_active", false);
  if (query.batch) q = q.eq("batch", query.batch);
  if (query.gender) q = q.eq("gender", query.gender);

  const { data, error } = await q.order(
    columnFor(query.sort),
    { ascending: query.dir === "asc", nullsFirst: false },
  );

  if (error) {
    throw new Error(error.message);
  }

  const all = (data ?? []) as unknown as MemberRow[];

  // Search narrows first, then the badge count is taken before the birth month is
  // applied, so "all" really means "everything this search matched".
  let rows = applySearch(all, query.q, search);
  const totalWithoutBirthMonth = rows.length;
  rows = applyBirthMonth(rows, query.birth_month);
  rows.sort((a, b) => compare(a, b, query.sort, query.dir));

  const total = rows.length;
  const from = (query.page - 1) * query.page_size;

  return {
    members: rows.slice(from, from + query.page_size),
    total,
    page: query.page,
    pageSize: query.page_size,
    pageCount: Math.max(1, Math.ceil(total / query.page_size)),
    totalWithoutBirthMonth,
  };
}

/** Every member matching the filter, for the exports. */
export async function fetchAllMembers(query: MemberQuery): Promise<MemberRow[]> {
  const sb = getSupabaseAdmin();
  let q = sb.from("members").select(SELECT);

  if (query.status === "active") q = q.eq("is_active", true);
  else if (query.status === "inactive") q = q.eq("is_active", false);
  if (query.batch) q = q.eq("batch", query.batch);
  if (query.gender) q = q.eq("gender", query.gender);

  const { data, error } = await q.order(columnFor(query.sort), {
    ascending: query.dir === "asc",
    nullsFirst: false,
  });

  if (error) {
    throw new Error(error.message);
  }

  let rows = applyBirthMonth((data ?? []) as unknown as MemberRow[], query.birth_month);
  rows = applySearch(rows, query.q);
  rows.sort((a, b) => compare(a, b, query.sort, query.dir));
  return rows;
}

function columnFor(sort: MemberSort): string {
  switch (sort) {
    case "batch":
      return "batch";
    case "date_of_birth":
      return "date_of_birth";
    case "name":
    default:
      return "full_name";
  }
}
