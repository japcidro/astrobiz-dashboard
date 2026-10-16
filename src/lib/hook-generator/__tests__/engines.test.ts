import { describe, it, expect } from "vitest";
import { beatSeconds, clipSecondsFor, estimateCredits, motionPrompt, stillPrompt } from "../engines";

describe("beatSeconds", () => {
  it("times a line at about 2.6 words a second", () => {
    expect(beatSeconds("If your part looks like this")).toBe(2.6);
  });

  it("gives a silent beat two seconds", () => {
    expect(beatSeconds("")).toBe(2);
  });

  it("keeps very short and very long lines in range", () => {
    expect(beatSeconds("Look")).toBe(1.5);
    expect(beatSeconds(Array.from({ length: 40 }, () => "word").join(" "))).toBe(7.5);
  });
});

describe("clipSecondsFor", () => {
  it("asks Veo for the shortest length that fits the line", () => {
    expect(clipSecondsFor("veo3_1", 2.6)).toBe(4);
    expect(clipSecondsFor("veo3_1", 4.2)).toBe(6);
    expect(clipSecondsFor("veo3_1", 7.5)).toBe(8);
  });

  it("asks Seedance for 4 to 15 seconds", () => {
    expect(clipSecondsFor("seedance_2_0_mini", 2)).toBe(4);
    expect(clipSecondsFor("seedance_2_0_mini", 6.1)).toBe(7);
  });
});

describe("estimateCredits", () => {
  it("prices two beats on the defaults like the plan", () => {
    expect(estimateCredits({ beats: 2, image: "seedream_5_0_flash", video: "veo3_1" })).toEqual({ stills: 1, total: 33 });
    expect(estimateCredits({ beats: 2, image: "seedream_5_0_flash", video: "seedance_2_0_mini" })).toEqual({ stills: 1, total: 5 });
  });
});

describe("stillPrompt", () => {
  it("names each reference by its place and keeps the hand on the head", () => {
    const p = stillPrompt("A salon.", ["expert", "client"], "");
    expect(p).toContain("image 1 is the expert");
    expect(p).toContain("image 2 is the client");
    expect(p).toContain("hand is already on or touching the client's head");
    expect(p).toContain("No text");
  });

  it("adds the marketer's fix", () => {
    expect(stillPrompt("A salon.", [], "make the part wider")).toContain("Change from the last attempt: make the part wider.");
  });
});

describe("motionPrompt", () => {
  it("has Veo say the exact line", () => {
    const p = motionPrompt({ motion: "He pats the crown.", line: 'It\'s "hormonal"', voice: "a Filipino man in his 30s", model: "veo3_1" });
    expect(p).toContain(`says, with natural lip sync (voice: a Filipino man in his 30s): "It's 'hormonal'"`);
    expect(p).toContain("touches the client's hair or scalp");
  });

  it("keeps Seedance silent of words", () => {
    const p = motionPrompt({ motion: "He pats the crown.", line: "Look at this", voice: "", model: "seedance_2_0_mini" });
    expect(p).not.toContain("Look at this");
    expect(p).toContain("talks naturally");
  });
});
