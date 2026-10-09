import { describe, expect, it } from "vitest";

import { isMissingTableError, isUndeployedSchemaError, migrationMessage } from "./migration-error";

describe("isMissingTableError", () => {
  it("recognises the code Postgres uses for an absent table", () => {
    expect(
      isMissingTableError({
        code: "42P01",
        message: 'relation "public.council_members" does not exist',
      }),
    ).toBe(true);
  });

  it("does not treat a missing column as a missing table", () => {
    // Both say "does not exist", and they have different fixes. With the code present it is checked
    // first precisely so the message alone cannot decide this.
    expect(
      isMissingTableError({ code: "42703", message: 'column "photo_url" does not exist' }),
    ).toBe(false);
  });

  it("falls back to the message when there is no code", () => {
    // Some clients and some proxies hand back a message with nothing else.
    expect(isMissingTableError({ message: 'relation "church_profile" does not exist' })).toBe(true);
    expect(isMissingTableError({ message: "schema cache is stale" })).toBe(true);
  });

  it("does not fire on an ordinary query failure", () => {
    expect(isMissingTableError({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMissingTableError({ code: "23503", message: "permission denied" })).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
    expect(isMissingTableError({})).toBe(false);
  });
});

describe("isUndeployedSchemaError", () => {
  it("covers a table, a column and a function", () => {
    // All three mean the same thing to the person holding the screen: this build is ahead of the
    // database. The RPC route in particular reports a missing function, not a missing table.
    expect(isUndeployedSchemaError({ code: "42P01", message: "x" })).toBe(true);
    expect(isUndeployedSchemaError({ code: "42703", message: "x" })).toBe(true);
    expect(isUndeployedSchemaError({ code: "42883", message: "x" })).toBe(true);
  });

  it("still refuses to guess from a coded error", () => {
    expect(isUndeployedSchemaError({ code: "23505", message: "does not exist" })).toBe(false);
  });

  it("falls back to the message when there is no code", () => {
    expect(isUndeployedSchemaError({ message: "function does not exist" })).toBe(true);
  });
});

describe("migrationMessage", () => {
  it("names the file to apply, because that is the actionable step", () => {
    // "There is a problem" is a diagnosis the reader has to arrive at themselves.
    const message = migrationMessage("038_church_ministry.sql");
    expect(message).toContain("038_church_ministry.sql");
    expect(message).toMatch(/apply/i);
  });
});