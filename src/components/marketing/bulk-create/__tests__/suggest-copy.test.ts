import { describe, expect, it } from "vitest";
import { applySuggestion, copyBorderClass, keepSuggestions } from "../suggest-copy";
import { makeEmptyRow, suggestedState, type BulkAdRow, type CopySuggestion } from "../types";

const suggestion: CopySuggestion = {
  read: { person: "Woman, about 60", setting: "Sofa", text_on_image: "Masakit pa rin?", product_visible: false, promo: "", angle: "morning knee pain" },
  primary_text: "Lola, hindi dapat tiisin.",
  headline: "Masakit pa rin ang tuhod?",
  description: "COD nationwide.",
  headline_alternatives: ["Balik-lakad nang walang kirot", "Masakit pa rin ang tuhod?"],
};

const second: CopySuggestion = { ...suggestion, primary_text: "Tito, balik-takbo.", headline: "Back to your run", description: "One a day." };

function withSuggestion(row: BulkAdRow, s: CopySuggestion, replace = false): BulkAdRow {
  return { ...row, ...applySuggestion(row, s, replace) };
}

describe("applySuggestion", () => {
  it("fills every empty field and marks it suggested", () => {
    const row = withSuggestion(makeEmptyRow(), suggestion);
    expect(row.primary_text).toBe(suggestion.primary_text);
    expect(row.headline).toBe(suggestion.headline);
    expect(row.description).toBe(suggestion.description);
    expect(row.suggest_status).toBe("done");
    expect(suggestedState(row, "primary_text")).toBe("suggested");
    expect(suggestedState(row, "headline")).toBe("suggested");
  });

  it("never overwrites text the marketer typed", () => {
    const typed = { ...makeEmptyRow(), headline: "My own headline" };
    const row = withSuggestion(typed, suggestion);
    expect(row.headline).toBe("My own headline");
    expect(suggestedState(row, "headline")).toBeNull();
    expect(row.primary_text).toBe(suggestion.primary_text);
  });

  it("a regeneration replaces untouched suggestions but keeps an edit", () => {
    const first = withSuggestion(makeEmptyRow(), suggestion);
    const edited = { ...first, headline: "Edited by hand" };
    expect(suggestedState(edited, "headline")).toBe("edited");
    const row = withSuggestion(edited, second, true);
    expect(row.primary_text).toBe(second.primary_text);
    expect(row.description).toBe(second.description);
    expect(row.headline).toBe("Edited by hand");
    expect(suggestedState(row, "headline")).toBe("edited");
    expect(row.suggested.headline).toBe(suggestion.headline);
  });

  it("without replace, a second suggestion leaves a filled row alone", () => {
    const first = withSuggestion(makeEmptyRow(), suggestion);
    const row = withSuggestion(first, second, false);
    expect(row.headline).toBe(suggestion.headline);
  });
});

describe("keepSuggestions and borders", () => {
  it("keeping turns suggested fields into plain fields", () => {
    const first = withSuggestion(makeEmptyRow(), suggestion);
    expect(copyBorderClass(first, "headline")).toContain("violet");
    const kept = { ...first, ...keepSuggestions() };
    expect(suggestedState(kept, "headline")).toBeNull();
    expect(copyBorderClass(kept, "headline")).toContain("gray-600");
  });

  it("an edited field shows blue, an empty untouched field red, a writing one pulses", () => {
    const first = withSuggestion(makeEmptyRow(), suggestion);
    expect(copyBorderClass({ ...first, headline: "x" }, "headline")).toContain("blue");
    expect(copyBorderClass(makeEmptyRow(), "headline")).toContain("red");
    expect(copyBorderClass({ ...makeEmptyRow(), suggest_status: "writing" }, "headline")).toContain("animate-pulse");
  });
});
