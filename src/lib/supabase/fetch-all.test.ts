import { describe, expect, it, vi } from "vitest";
import { fetchAllRows, SUPABASE_PAGE_SIZE } from "./fetch-all";

/**
 * These tests exist because the failure they guard against is silent. PostgREST does not error when a
 * select exceeds `db-max-rows`; it returns a short page. A caller that never asks for a second page
 * therefore looks correct in every test that uses a small fixture, and only goes wrong on real data.
 */

const page = <T>(rows: T[], size: number) =>
  vi.fn(async (from: number, to: number) => {
    expect(to - from + 1).toBe(size);
    return { data: rows.slice(from, to + 1), error: null };
  });

describe("fetchAllRows", () => {
  it("asks for another page until a short one arrives", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const query = page(rows, SUPABASE_PAGE_SIZE);

    const result = await fetchAllRows(query);

    expect(result).toHaveLength(2500);
    expect(result[2499]).toEqual({ id: 2499 });
    // 1000 + 1000 + 500: the third page is short, so there is no fourth request.
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("stops after one full page plus the final short page", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: i }));
    const query = page(rows, SUPABASE_PAGE_SIZE);

    const result = await fetchAllRows(query);

    expect(result).toHaveLength(1001);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("returns an empty list without a second request when there are no rows", async () => {
    const query = page([], SUPABASE_PAGE_SIZE);

    await expect(fetchAllRows(query)).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("surfaces a page error instead of returning the rows read so far", async () => {
    const query = vi.fn(async (from: number) =>
      from === 0
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
        : { data: null, error: { message: "connection reset" } },
    );

    await expect(fetchAllRows(query)).rejects.toThrow("connection reset");
  });

  it("honours a custom page size", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const query = page(rows, 2);

    await expect(fetchAllRows(query, 2)).resolves.toHaveLength(5);
    expect(query).toHaveBeenCalledTimes(3);
  });
});
