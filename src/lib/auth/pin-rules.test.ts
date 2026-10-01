import { describe, expect, it } from "vitest";
import {
  canClearSuperAdminPin,
  checkPin,
  checkPinConfirmation,
  DEFAULT_PIN,
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
} from "./pin-rules";

const code = (pin: string) => {
  const result = checkPin(pin);
  return result.ok ? "OK" : result.code;
};

describe("checkPin", () => {
  it("accepts a reasonable PIN", () => {
    expect(checkPin("4702").ok).toBe(true);
    expect(checkPin("8173").ok).toBe(true);
    expect(checkPin("135790").ok).toBe(true);
    expect(checkPin("9081726354").ok).toBe(true);
  });

  it("rejects the fresh-install default", () => {
    // 1234 is a sequential run, so it is rejected (as PIN_SEQUENTIAL) before the
    // common list is even consulted. The point is that it can never be set.
    expect(checkPin(DEFAULT_PIN).ok).toBe(false);
  });

  it("rejects repeated digits", () => {
    expect(code("0000")).toBe("PIN_REPEATED");
    expect(code("1111")).toBe("PIN_REPEATED");
    expect(code("99999")).toBe("PIN_REPEATED");
  });

  it("rejects sequential digits ascending and descending", () => {
    expect(code("1234")).toBe("PIN_SEQUENTIAL");
    expect(code("2345")).toBe("PIN_SEQUENTIAL");
    expect(code("3456")).toBe("PIN_SEQUENTIAL");
    expect(code("4567")).toBe("PIN_SEQUENTIAL");
    expect(code("5678")).toBe("PIN_SEQUENTIAL");
    expect(code("6789")).toBe("PIN_SEQUENTIAL");
    expect(code("4321")).toBe("PIN_SEQUENTIAL");
    expect(code("9876")).toBe("PIN_SEQUENTIAL");
  });

  it("allows four digits that are not a run", () => {
    expect(checkPin("1357").ok).toBe(true);
    expect(checkPin("2468").ok).toBe(true);
    // 2,1,0 then a repeat: not a four-digit run, so it is allowed.
    expect(checkPin("2100").ok).toBe(true);
  });

  it("rejects short and long PINs", () => {
    expect(code("123")).toBe("PIN_LENGTH");
    expect(code("1".repeat(MAX_PIN_LENGTH + 1))).toBe("PIN_LENGTH");
    expect(checkPin("135792468011").ok).toBe(true);
    expect("135792468011".length).toBe(MAX_PIN_LENGTH);
    expect(MIN_PIN_LENGTH).toBe(4);
  });

  it("rejects non-digits for new PINs", () => {
    expect(code("12a4")).toBe("PIN_DIGITS_ONLY");
    expect(code("abcd")).toBe("PIN_DIGITS_ONLY");
    expect(code("47 02")).toBe("PIN_DIGITS_ONLY");
  });

  it("rejects an empty PIN", () => {
    expect(code("")).toBe("PIN_REQUIRED");
    expect(code("   ")).toBe("PIN_REQUIRED");
  });

  it("ignores surrounding whitespace", () => {
    expect(checkPin("  4702  ").ok).toBe(true);
  });

  it("rejects common PINs beyond the default and runs", () => {
    expect(code("1010")).toBe("PIN_TOO_COMMON");
    expect(code("1122")).toBe("PIN_TOO_COMMON");
    expect(code("2000")).toBe("PIN_TOO_COMMON");
    expect(code("2001")).toBe("PIN_TOO_COMMON");
    expect(code("0123")).toBe("PIN_SEQUENTIAL");
  });

  it("treats the seeded PIN 1234 as a sequential run", () => {
    // It is caught as sequential, which is the stronger message.
    expect(code(DEFAULT_PIN)).toBe("PIN_SEQUENTIAL");
  });

  it("always carries a message for rejections and none for success", () => {
    const bad = checkPin("1234");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message.length).toBeGreaterThan(10);
    const good = checkPin("4702");
    expect(good.ok).toBe(true);
  });
});

describe("checkPinConfirmation", () => {
  it("passes when both match", () => {
    expect(checkPinConfirmation("4702", "4702").ok).toBe(true);
  });

  it("fails when they differ", () => {
    const result = checkPinConfirmation("4702", "4703");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PIN_MISMATCH");
  });
});

describe("canClearSuperAdminPin", () => {
  it("allows clearing with no pending reports", () => {
    expect(canClearSuperAdminPin(0).ok).toBe(true);
  });

  it("refuses while reports are pending and names the count", () => {
    const one = canClearSuperAdminPin(1);
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.message).toContain("1 pending report");

    const many = canClearSuperAdminPin(3);
    if (!many.ok) expect(many.message).toContain("3 pending reports");
  });
});
