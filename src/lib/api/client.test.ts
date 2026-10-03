import { describe, expect, it } from "vitest";
import { dataOf, fieldOf, messageOf, readEnvelope } from "./client";

/** Minimal stand-in for the Response methods these helpers touch. */
function jsonRes(body: unknown, ok = true): Response {
  return { json: async () => body, ok } as unknown as Response;
}

/** A response whose body is not JSON at all, e.g. an HTML error page from the platform. */
function brokenRes(): Response {
  return { json: async () => Promise.reject(new SyntaxError("Unexpected token <")) } as unknown as Response;
}

describe("readEnvelope", () => {
  it("pulls the payload out of data", async () => {
    const env = await readEnvelope<{ masses: string[] }>(
      jsonRes({ ok: true, data: { masses: ["a", "b"] } }),
    );
    expect(dataOf(env)).toEqual({ masses: ["a", "b"] });
  });

  it("reads the message out of error.message", async () => {
    const env = await readEnvelope(jsonRes({ ok: false, error: { code: "REPORT_LOCKED", message: "Locked." } }));
    expect(messageOf(env, "fallback")).toBe("Locked.");
  });

  it("returns null when the body is not JSON", async () => {
    expect(await readEnvelope(brokenRes())).toBeNull();
  });

  it("returns null when the body has no ok flag", async () => {
    // A bare NextResponse.json body is NOT an envelope. Reporting null is what stops a caller
    // treating a plain route's payload as if it were nested under data.
    expect(await readEnvelope(jsonRes({ labels: ["lector"] }))).toBeNull();
  });

  it("returns null for a null body", async () => {
    expect(await readEnvelope(jsonRes(null))).toBeNull();
  });

  it("keeps a falsy payload rather than treating it as missing", async () => {
    // data: 0 and data: "" are legitimate payloads. A truthiness check would discard them.
    expect(dataOf(await readEnvelope(jsonRes({ ok: true, data: 0 })))).toBe(0);
    expect(dataOf(await readEnvelope(jsonRes({ ok: true, data: "" })))).toBe("");
  });

  it("falls back when there is no message to show", async () => {
    expect(messageOf(await readEnvelope(jsonRes({ ok: false, error: { code: "X" } })), "fb")).toBe("fb");
    expect(messageOf(await readEnvelope(jsonRes({ ok: false, error: { code: "X", message: "" } })), "fb")).toBe(
      "fb",
    );
    expect(messageOf(null, "fb")).toBe("fb");
  });

  it("never lets an error object through as the message", async () => {
    // This is the bug that shipped: `j.error` read as a string rendered "[object Object]", and
    // passing the object itself to a React child throws "Objects are not valid as a React child".
    const env = await readEnvelope(jsonRes({ ok: false, error: { code: "X", message: "Real text." } }));
    expect(typeof messageOf(env, "fb")).toBe("string");
  });

  it("reads machine-readable extras out of error.fields", async () => {
    const env = await readEnvelope(
      jsonRes({ ok: false, error: { code: "SESSION_EXISTS", message: "no", fields: { existing_session_id: "abc" } } }),
    );
    expect(fieldOf(env, "existing_session_id")).toBe("abc");
    expect(fieldOf(env, "missing")).toBeUndefined();
    expect(fieldOf(null, "existing_session_id")).toBeUndefined();
  });
});