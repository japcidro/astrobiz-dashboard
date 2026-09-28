/** Choices on the Hook Studio brief. Kept small on purpose. */

export const LANES = [
  { id: "prayer", label: "Prayer" },
  { id: "motivation", label: "Motivation" },
  { id: "manifestation", label: "Manifestation" },
] as const;

export type Lane = (typeof LANES)[number]["id"];

export const CREATORS = [
  "Filipina, 20s",
  "Filipina, 30s",
  "Filipino, 20s",
  "Filipino, 30s",
  "Let the model decide",
] as const;

export type Creator = (typeof CREATORS)[number];

export const SCREEN_MODES = [
  { id: "dark", label: "Dark, overlay the app later" },
  { id: "app", label: "Show the real Play screen" },
] as const;

export type ScreenMode = (typeof SCREEN_MODES)[number]["id"];

/** What Soul 2 is asked for when generating face candidates. */
export function facePrompt(creator: string): string {
  const who = creator === "Let the model decide" ? "a young Filipino adult" : `a ${creator}`;
  return (
    `Candid phone-camera portrait of ${who}, head and shoulders, looking slightly off camera, ` +
    `natural window light, real skin texture, no makeup look, plain everyday clothes, ` +
    `soft neutral background, slight grain, no text, no logo.`
  );
}
