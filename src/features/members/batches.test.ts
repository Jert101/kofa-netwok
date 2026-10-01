import { describe, expect, it } from "vitest";
import { batchInUseMessage, isBatchInUse, plural } from "@/features/members/batches";

describe("batchInUseMessage", () => {
  it("reads the way the spec's example does", () => {
    expect(batchInUseMessage("2025", 34, 1)).toBe(
      "2025 is used by 34 members and 1 payment structure.",
    );
  });

  it("pluralises both counts", () => {
    expect(batchInUseMessage("2025", 2, 3)).toBe(
      "2025 is used by 2 members and 3 payment structures.",
    );
  });

  it("names only the members when no structure uses the year", () => {
    expect(batchInUseMessage("2024", 12, 0)).toBe("2024 is used by 12 members.");
  });

  it("names only the structures, which a batch can have with nobody in it", () => {
    expect(batchInUseMessage("2024", 0, 1)).toBe(
      "2024 is used by 1 payment structure.",
    );
  });

  it("drops a zero rather than saying 'used by 0 members'", () => {
    expect(batchInUseMessage("2024", 0, 0)).toBe("2024 is used by .");
  });
});

describe("plural", () => {
  it("takes the singular for exactly one", () => {
    expect(plural(1, "member")).toBe("1 member");
  });

  it("adds an s for anything else", () => {
    expect(plural(0, "member")).toBe("0 members");
    expect(plural(2, "payment structure")).toBe("2 payment structures");
  });
});

describe("isBatchInUse", () => {
  it("is true when members use it", () => {
    expect(isBatchInUse({ member_count: 1, structure_count: 0 })).toBe(true);
  });

  it("is true when only a payment structure uses it", () => {
    expect(isBatchInUse({ member_count: 0, structure_count: 1 })).toBe(true);
  });

  it("treats a missing structure count as zero", () => {
    expect(isBatchInUse({ member_count: 0 })).toBe(false);
  });
});
