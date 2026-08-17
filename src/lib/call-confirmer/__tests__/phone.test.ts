import { describe, it, expect } from "vitest";
import { normalizePhPhone } from "../phone";

describe("normalizePhPhone", () => {
  it("accepts the way people actually type a number", () => {
    expect(normalizePhPhone("09551949848")).toBe("+639551949848");
    expect(normalizePhPhone("9551949848")).toBe("+639551949848");
    expect(normalizePhPhone("639551949848")).toBe("+639551949848");
    expect(normalizePhPhone("+639551949848")).toBe("+639551949848");
  });

  it("ignores spaces, dashes and parentheses", () => {
    expect(normalizePhPhone("0955 194 9848")).toBe("+639551949848");
    expect(normalizePhPhone("0955-194-9848")).toBe("+639551949848");
    expect(normalizePhPhone("(0955) 194 9848")).toBe("+639551949848");
  });

  it("rejects anything that cannot be a PH mobile", () => {
    expect(normalizePhPhone("")).toBeNull();
    expect(normalizePhPhone("12345")).toBeNull();
    // Landline — PH mobiles always start with 9.
    expect(normalizePhPhone("0281234567")).toBeNull();
    expect(normalizePhPhone("+14155552671")).toBeNull();
    expect(normalizePhPhone("095519498480")).toBeNull();
  });
});
