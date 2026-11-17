import { describe, expect, it } from "vitest";
import { cleanConcept, ownPrompt } from "../own";
import { ownFinalText, type Attachment } from "../types";

const raw = {
  title: "The cap dad",
  approach: "identity",
  format: "sorting_line",
  audience: "the dad who wears a cap to every family photo",
  insight: "He hides it rather than talk about it.",
  authority: "",
  headline: "FOR DADS WHO OWN TOO MANY CAPS.",
  subhead: "FOLIQ HAIR RECOVERY STACK",
  callouts: ["", "  "],
  cta: "",
  visual: "A dad at a family lunch, cap on the table.",
  polish: "native",
  why: "He sees himself.",
  borrowed: "Sorting line",
  next_test: "Another person.",
  needs_person: true,
  model: 2,
  person: "man, late 30s",
  needs_product: true,
  shows_contents: false,
  design_spec: "A man at a table. The price reads PHP 990.",
};

describe("create your own: concepts", () => {
  it("keeps the words in reading order and drops empty slots", () => {
    const c = cleanConcept(raw, "c1", true, 3)!;
    expect(ownFinalText(c)).toBe("FOR DADS WHO OWN TOO MANY CAPS.\nFOLIQ HAIR RECOVERY STACK");
    expect(c.callouts).toEqual([]);
    expect(c.model_pick).toBe(2);
  });

  it("never picks a model that is not there, or a pack with no photo", () => {
    const c = cleanConcept(raw, "c1", false, 1)!;
    expect(c.model_pick).toBe(0);
    expect(c.needs_product).toBe(false);
  });

  it("rejects a concept with no format, no design or no words", () => {
    expect(cleanConcept({ ...raw, format: "carousel" }, "c1", true, 0)).toBeNull();
    expect(cleanConcept({ ...raw, design_spec: "" }, "c1", true, 0)).toBeNull();
    expect(cleanConcept({ ...raw, headline: "", subhead: "", callouts: [] }, "c1", true, 0)).toBeNull();
  });

  it("writes a prompt with the exact words, the pack lock and no reference", () => {
    const c = cleanConcept({ ...raw, format: "native_comparison", headline: "", subhead: "", callouts: ["3 months in, cap stays home", "absolutely not"] }, "c1", true, 0)!;
    const attachments: Attachment[] = [{ bucket: "b", path: "brand/FOLIQ/a.png", role: "product", label: "FOLIQ · bottle", kind: "bottle" }];
    const p = ownPrompt(c, attachments, "No doctor claims", "White bottle, teal band.");
    expect(p).toContain('"3 months in, cap stays home" / "absolutely not"');
    expect(p).toContain("White bottle, teal band.");
    expect(p).toContain("Portrait 4:5");
    expect(p).toContain("handwritten");
    expect(p).not.toMatch(/competitor's ad|reference's person/);
    expect(ownPrompt(c, attachments, "", null, "warmer light")).toContain("Change requested by the marketer, apply it: warmer light");
  });
});
