/**
 * Read every row of a query, in pages.
 *
 * PostgREST caps a single response at the project's `db-max-rows` -- Supabase's default is 1000 -- and
 * applies that cap silently. A select with no range returns the first 1000 rows and reports no error,
 * so any caller that counts from an unbounded select starts undercounting the moment the table passes
 * 1000 rows, with nothing in the response to say so.
 *
 * That is what made the top-servers list report 48 Masses for a server whose own page said 84. The
 * member page filters by `member_id` and therefore sees every row; the ranking read both table
 * wholes and saw one page of each. The same silent truncation was shortening the dashboard history,
 * which reads all attendance marks without a date filter.
 *
 * Paging is only correct with a stable `order`, because without one the server is free to return a
 * different slice for the same range on each request -- page 2 can then repeat rows from page 1 and
 * skip others. Every caller here orders by `id`.
 */

export const SUPABASE_PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Call `page(from, to)` until a short page arrives, and return every row.
 *
 * The first page that comes back smaller than `pageSize` is the last one: PostgREST returns exactly
 * `pageSize` rows while more exist and the remainder on the final page, so no extra empty request is
 * needed. An empty first page is handled by the same check.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => Page<T>,
  pageSize: number = SUPABASE_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}
