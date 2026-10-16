import { describe, it, expect } from "vitest";
import { DEFAULT_BEATS, beatSeconds, clipLengths, clipSecondsFor, estimateCredits, motionPrompt, ownStillPrompt, stillPrompt, validClipSeconds } from "../engines";

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

describe("clip lengths", () => {
  it("offers only what each model makes", () => {
    expect(clipLengths("veo3_1")).toEqual([4, 6, 8]);
    expect(clipLengths("seedance_2_0_mini")[0]).toBe(4);
    expect(clipLengths("seedance_2_0_mini").at(-1)).toBe(15);
  });

  it("keeps a valid choice and drops the rest to fit-the-line", () => {
    expect(validClipSeconds("veo3_1", 6)).toBe(6);
    expect(validClipSeconds("veo3_1", "8")).toBe(8);
    expect(validClipSeconds("veo3_1", 5)).toBeNull();
    expect(validClipSeconds("seedance_2_0_mini", 12)).toBe(12);
    expect(validClipSeconds("seedance_2_0_mini", 16)).toBeNull();
    expect(validClipSeconds("veo3_1", null)).toBeNull();
    expect(validClipSeconds("veo3_1", "")).toBeNull();
  });

  it("prices the chosen length", () => {
    expect(estimateCredits({ beats: 1, image: "seedream_5_0_flash", video: "veo3_1", seconds: 8 })).toEqual({ stills: 0.5, total: 32.5 });
    expect(estimateCredits({ beats: 1, image: "seedream_5_0_flash", video: "seedance_2_0_mini", seconds: 10 })).toEqual({ stills: 0.5, total: 5.5 });
  });
});

describe("the marketer's own beats", () => {
  it("starts new hooks with one move", () => {
    expect(DEFAULT_BEATS).toEqual(["crown_pat"]);
  });

  it("drops the head-tap rule from the image and the clip", () => {
    expect(stillPrompt("A doctor at a desk.", [], "", false)).not.toContain("hand is already on");
    const p = motionPrompt({ motion: "She smiles and nods.", line: "Look at this", voice: "", model: "veo3_1", headTap: false });
    expect(p).not.toContain("touches the client's hair");
    expect(p).toContain("The main person looks into the camera and says");
    expect(motionPrompt({ motion: "Slow push-in.", line: "", voice: "", model: "seedance_2_0_mini", headTap: false })).not.toContain("talks naturally");
  });

  it("uses their own image prompt as written, plus a fix", () => {
    expect(ownStillPrompt("My exact prompt.", "")).toBe("My exact prompt.");
    expect(ownStillPrompt("My exact prompt.", "warmer light")).toBe("My exact prompt. Change from the last attempt: warmer light.");
  });
});
