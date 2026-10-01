import { describe, expect, it } from "vitest";
import { buildPendingTwinMap } from "@/features/registrations/server/duplicates";

describe("buildPendingTwinMap", () => {
  it("leaves a name that appears once alone", () => {
    const page = [
      { id: "a", fullName: "Jerson L. Catadman" },
      { id: "b", fullName: "Maria Santos" },
    ];
    expect(buildPendingTwinMap(page, page).size).toBe(0);
  });

  it("flags both sides of a matching pair", () => {
    // Both applications are duplicates of each other, so both get the badge. Which
    // twin a row points at does not change the label, because they only match
    // while their normalized names are equal.
    const page = [
      { id: "a", fullName: "Jerson L. Catadman" },
      { id: "b", fullName: "jerson l catadman" },
    ];
    const twins = buildPendingTwinMap(page, page);
    expect(twins.get("a")?.id).toBe("b");
    expect(twins.get("b")?.id).toBe("a");
  });

  it("treats a written-out and an initialed middle name as different people", () => {
    // The rule only drops the period, it does not drop the initial. Someone who
    // signed up as "Jerson L. Catadman" and someone who signed up as
    // "Jerson Catadman" are flagged separately, because a missing initial is a
    // real difference and the flag is a hint for a human, not a verdict.
    const page = [
      { id: "a", fullName: "Jerson L. Catadman" },
      { id: "b", fullName: "Jerson Catadman" },
    ];
    expect(buildPendingTwinMap(page, page).size).toBe(0);
  });

  it("keeps accents distinct so two genuinely different people are not merged", () => {
    const page = [
      { id: "a", fullName: "Nino Bautista" },
      { id: "b", fullName: "Niño Bautista" },
    ];
    expect(buildPendingTwinMap(page, page).size).toBe(0);
  });

  it("flags a twin that is on another page, and names it", () => {
    // This is the case the old same-page comparison missed: the admin is looking
    // at page 1 and the second application is further down the queue.
    const page = [{ id: "a", fullName: "Maria Santos" }];
    const allPending = [
      { id: "a", fullName: "Maria Santos" },
      { id: "z", fullName: "MARIA SANTOS" },
    ];
    const twins = buildPendingTwinMap(page, allPending);
    expect(twins.get("a")?.id).toBe("z");
    expect(twins.get("a")?.fullName).toBe("MARIA SANTOS");
  });

  it("flags every row in a group of three", () => {
    const page = [
      { id: "a", fullName: "Maria Santos" },
      { id: "b", fullName: "Maria Santos" },
      { id: "c", fullName: "MARIA SANTOS" },
    ];
    const twins = buildPendingTwinMap(page, page);
    expect([twins.has("a"), twins.has("b"), twins.has("c")]).toEqual([true, true, true]);
    for (const id of ["a", "b", "c"]) {
      expect(twins.get(id)?.id).not.toBe(id);
    }
  });

  it("does not match a row against itself", () => {
    const page = [{ id: "a", fullName: "Maria Santos" }];
    expect(buildPendingTwinMap(page, page).size).toBe(0);
  });

  it("ignores a pending request that the page does not show", () => {
    const page = [{ id: "a", fullName: "Maria Santos" }];
    const allPending = [...page, { id: "z", fullName: "Someone Else" }];
    expect(buildPendingTwinMap(page, allPending).size).toBe(0);
  });

  it("does not fail on a row with an empty name", () => {
    const page = [
      { id: "a", fullName: "" },
      { id: "b", fullName: "" },
    ];
    expect(buildPendingTwinMap(page, page).size).toBe(0);
  });
});
