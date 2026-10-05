import { describe, expect, it } from "vitest";
import { dataOf, fieldOf, messageOf, readEnvelope } from "./client";

/** Minimal stand-in for the Response methods these helpers touch. */
function jsonRes(body: unknown, ok = true, status = 200): Response {
  return { json: async () => body, ok, status } as unknown as Response;
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

  describe("legacy bare-error bodies", () => {
    // The guard answered 401 as `{ error: "Unauthorized" }` and several older routes still do. Callers
    // were getting null and showing their own generic wording, so a signed-out user was told the page
    // failed to load rather than that they needed to sign in again.
    it("reads a bare error string as a failure", async () => {
      const env = await readEnvelope(jsonRes({ error: "Session expired" }, false, 401));
      expect(env).not.toBeNull();
      expect(env?.ok).toBe(false);
      expect(messageOf(env, "fallback")).toBe("Session expired");
    });

    it("names a code from the status so callers can still branch on it", async () => {
      const env = await readEnvelope(jsonRes({ error: "Unauthorized" }, false, 401));
      expect(env?.ok === false && env.error.code).toBe("UNAUTHENTICATED");
      const locked = await readEnvelope(jsonRes({ error: "Month is closed" }, false, 409));
      expect(locked?.ok === false && locked.error.code).toBe("CONFLICT");
      const missing = await readEnvelope(jsonRes({ error: "Not found." }, false, 404));
      expect(missing?.ok === false && missing.error.code).toBe("NOT_FOUND");
    });

    it("still returns null for a bare body that is a payload, not an error", async () => {
      // A plain route's success body must not be mistaken for a failure.
      expect(await readEnvelope(jsonRes({ labels: ["lector"] }))).toBeNull();
      expect(await readEnvelope(jsonRes({ members: [] }))).toBeNull();
    });

    it("ignores a non-string or empty error", async () => {
      expect(await readEnvelope(jsonRes({ error: "" }))).toBeNull();
      expect(await readEnvelope(jsonRes({ error: { code: "X" } }))).toBeNull();
    });
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