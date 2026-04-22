import { describe, it, expect } from "vitest";
import { parseScripts } from "../script-parser";

const CANONICAL_BATCH = `Here are your scripts:

## SCRIPT 1 — Daily cap switching anxiety ends
**Avatar:** Male commuter, 26-34 | **Type:** D | **Intensity:** 9 | **Capacity:** 8

**HOOK:**
Dati ang dami kong cap pero I can say this one is built different.

**BODY SCRIPT:**
Every morning, napipilitan akong pumili kung anong cap ang kasama ko. Pang-run? Pang-meeting? Pang-labas? Tapos pagdating ng tanghali, nangangamoy na ulit. Kaya nahanap ko yung AIRTEK — Dual Defense technology yan, Airflow Design plus Silver-Infused Ag fabric. Same tech na gamit ng Lululemon at Under Armour. Walang amoy, mabilis matuyo, magaan. Isang cap lang — araw-araw.

**VARIANT HOOKS:**
1. Tapos na ako magpalit-palit ng cap araw-araw.
2. Isang cap lang, every scenario — finally.
3. Pag nasanay ka na dito, mahirap na bumalik.

---

## SCRIPT 2 — Cap smells after 3 weeks no matter how you wash
**Avatar:** Male runner, 28 | **Type:** E | **Intensity:** 9 | **Capacity:** 7

**HOOK:**
Bakit ba lagi nangangamoy ang cap kahit nilalabhan mo?

**BODY SCRIPT:**
Hindi mo kasalanan — yung cap ang problema. Dead Air construction kasi yan — walang airflow, walang antibacterial. Kaya kahit hugasan mo, bumabalik yung amoy kasi kumakapit na yung bacteria sa fibers. Yung AIRTEK Cap, Dual Defense. Silver-Infused Ag fabric pumapatay ng bacteria on contact. After 4 weeks of daily wear, pinagpawisan ako grabe — walang amoy pa rin.

**VARIANT HOOKS:**
1. Three weeks in, amoy na naman ang cap mo.
2. Washing doesn't fix the smell — heres why.
3. Yung amoy, hindi galing sayo.
`;

describe("parseScripts", () => {
  it("parses a canonical batch of two scripts", () => {
    const scripts = parseScripts(CANONICAL_BATCH);
    expect(scripts).toHaveLength(2);

    const [s1, s2] = scripts;

    expect(s1.script_number).toBe(1);
    expect(s1.angle_title).toBe("Daily cap switching anxiety ends");
    expect(s1.avatar).toBe("Male commuter, 26-34");
    expect(s1.angle_type).toBe("D");
    expect(s1.intensity).toBe(9);
    expect(s1.capacity).toBe(8);
    expect(s1.hook).toContain("built different");
    expect(s1.body_script).toContain("Every morning");
    expect(s1.variant_hooks).toHaveLength(3);
    expect(s1.variant_hooks[0]).toBe("Tapos na ako magpalit-palit ng cap araw-araw.");

    expect(s2.script_number).toBe(2);
    expect(s2.angle_type).toBe("E");
    expect(s2.intensity).toBe(9);
    expect(s2.capacity).toBe(7);
  });

  it("returns empty array for empty or non-script content", () => {
    expect(parseScripts("")).toEqual([]);
    expect(parseScripts("Just some regular AI chat response.")).toEqual([]);
    expect(parseScripts(null as unknown as string)).toEqual([]);
  });

  it("ignores a preamble before the first script header", () => {
    const input = `Sure, here are your scripts:\n\n${CANONICAL_BATCH}`;
    const scripts = parseScripts(input);
    expect(scripts).toHaveLength(2);
  });

  it("tolerates en-dash and hyphen in the header separator", () => {
    const variations = [
      "## SCRIPT 1 — Angle title\n**HOOK:**\nHook line\n\n**BODY SCRIPT:**\nBody here\n\n**VARIANT HOOKS:**\n1. Alt one\n",
      "## SCRIPT 2 – Angle title\n**HOOK:**\nHook line\n\n**BODY SCRIPT:**\nBody here\n\n**VARIANT HOOKS:**\n1. Alt one\n",
      "## SCRIPT 3 - Angle title\n**HOOK:**\nHook line\n\n**BODY SCRIPT:**\nBody here\n\n**VARIANT HOOKS:**\n1. Alt one\n",
    ];

    for (const input of variations) {
      const scripts = parseScripts(input);
      expect(scripts).toHaveLength(1);
      expect(scripts[0].angle_title).toBe("Angle title");
    }
  });

  it("skips scripts missing HOOK or BODY SCRIPT", () => {
    const input = `## SCRIPT 1 — Incomplete
**HOOK:**
Only a hook, no body

## SCRIPT 2 — Complete
**HOOK:**
A hook
**BODY SCRIPT:**
A body
`;
    const scripts = parseScripts(input);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].script_number).toBe(2);
  });

  it("returns null metadata when the metadata row is missing", () => {
    const input = `## SCRIPT 1 — No metadata row
**HOOK:**
A hook
**BODY SCRIPT:**
A body
`;
    const scripts = parseScripts(input);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].avatar).toBeNull();
    expect(scripts[0].angle_type).toBeNull();
    expect(scripts[0].intensity).toBeNull();
    expect(scripts[0].capacity).toBeNull();
  });

  it("rejects out-of-range intensity/capacity values", () => {
    const input = `## SCRIPT 1 — Out of range
**Avatar:** X | **Type:** D | **Intensity:** 99 | **Capacity:** 0
**HOOK:**
Hook
**BODY SCRIPT:**
Body
`;
    const scripts = parseScripts(input);
    expect(scripts[0].intensity).toBeNull();
    expect(scripts[0].capacity).toBeNull();
  });

  it("accepts variant hooks with different prefixes", () => {
    const input = `## SCRIPT 1 — Variant prefix test
**HOOK:**
Hook
**BODY SCRIPT:**
Body
**VARIANT HOOKS:**
1) numbered with paren
- dash prefix
• bullet prefix
2. numbered with dot
`;
    const scripts = parseScripts(input);
    expect(scripts[0].variant_hooks).toEqual([
      "numbered with paren",
      "dash prefix",
      "bullet prefix",
      "numbered with dot",
    ]);
  });

  it("strips bold markdown from angle title", () => {
    const input = `## SCRIPT 1 — **Bolded title text**
**HOOK:**
Hook
**BODY SCRIPT:**
Body
`;
    const scripts = parseScripts(input);
    expect(scripts[0].angle_title).toBe("Bolded title text");
  });

  it("does not bleed content between adjacent scripts", () => {
    const scripts = parseScripts(CANONICAL_BATCH);
    expect(scripts[0].body_script).not.toContain("Bakit ba lagi nangangamoy");
    expect(scripts[1].body_script).not.toContain("Every morning");
  });

  it("handles missing script number in header", () => {
    const input = `## SCRIPT — Unnumbered script
**HOOK:**
Hook
**BODY SCRIPT:**
Body
`;
    const scripts = parseScripts(input);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].script_number).toBeNull();
    expect(scripts[0].angle_title).toBe("Unnumbered script");
  });
});
