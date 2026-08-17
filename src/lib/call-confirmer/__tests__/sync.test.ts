import { describe, it, expect } from "vitest";
import { deriveOutcomeFromStructured } from "../sync";

describe("deriveOutcomeFromStructured", () => {
  it("returns null when there is nothing to work from", () => {
    expect(deriveOutcomeFromStructured(undefined)).toBeNull();
    expect(deriveOutcomeFromStructured({})).toBeNull();
  });

  it("confirms a clean yes without flagging a VA", () => {
    expect(deriveOutcomeFromStructured({ confirmed: "yes" })).toEqual({
      outcome: "confirmed",
      needsVa: false,
      reason: null,
    });
  });

  it("escalates a yes that still needs a human", () => {
    const result = deriveOutcomeFromStructured({
      confirmed: "yes",
      needs_human: true,
      reason: "Customer asked about the refund policy",
    });
    expect(result?.outcome).toBe("escalated_to_human");
    expect(result?.needsVa).toBe(true);
  });

  it("records a decline", () => {
    const result = deriveOutcomeFromStructured({
      confirmed: "no",
      reason: "Customer said they never ordered this",
    });
    expect(result?.outcome).toBe("declined");
  });

  it("flags an unclear answer for follow-up rather than guessing", () => {
    const result = deriveOutcomeFromStructured({ confirmed: "unclear" });
    expect(result?.outcome).toBeNull();
    expect(result?.needsVa).toBe(true);
    expect(result?.reason).toMatch(/clear yes or no/i);
  });

  it("keeps the order confirmed but flags a VA when the address was corrected", () => {
    const result = deriveOutcomeFromStructured({
      confirmed: "yes",
      address_correct: false,
      corrected_address: "123 Rizal Ave, Cebu City",
    });
    // The order still stands — only the address needs a human to verify.
    expect(result?.outcome).toBe("confirmed");
    expect(result?.needsVa).toBe(true);
    expect(result?.reason).toContain("123 Rizal Ave, Cebu City");
  });

  it("flags a wrong address even when no replacement was given", () => {
    const result = deriveOutcomeFromStructured({
      confirmed: "yes",
      address_correct: false,
    });
    expect(result?.needsVa).toBe(true);
    expect(result?.reason).toMatch(/address is wrong/i);
  });

  it("does not flag when the address was confirmed correct", () => {
    const result = deriveOutcomeFromStructured({
      confirmed: "yes",
      address_correct: true,
      corrected_address: "",
    });
    expect(result?.needsVa).toBe(false);
  });
});
