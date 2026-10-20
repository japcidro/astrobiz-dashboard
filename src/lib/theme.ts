/**
 * The five dashboard themes. The tokens live in src/app/globals.css under
 * [data-theme="..."]; this file is the list the picker shows and the names
 * the cookie and the employees.theme column accept.
 */
export const THEMES = ["night", "ledger", "control", "studio", "forest"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "night";

/** Cookie that carries the theme to the server so the first paint is right. */
export const THEME_COOKIE = "astrobiz-theme";

export interface ThemeInfo {
  id: Theme;
  name: string;
  blurb: string;
  /** Swatches for the picker: canvas, panel, text, accent. */
  swatch: [string, string, string, string];
  light: boolean;
}

export const THEME_INFO: Record<Theme, ThemeInfo> = {
  night: {
    id: "night",
    name: "Night shift",
    blurb: "Dark, sage accent, calm for long shifts",
    swatch: ["#0b1110", "#121a18", "#e8eeeb", "#3fc9a4"],
    light: false,
  },
  ledger: {
    id: "ledger",
    name: "Daylight ledger",
    blurb: "Light paper, teal ink, square corners",
    swatch: ["#f4f5f2", "#ffffff", "#161a18", "#0e7c66"],
    light: true,
  },
  control: {
    id: "control",
    name: "Mission control",
    blurb: "Navy, amber, dense rows, uppercase labels",
    swatch: ["#0a0e14", "#10161f", "#e6edf3", "#f5a524"],
    light: false,
  },
  studio: {
    id: "studio",
    name: "Soft studio",
    blurb: "Light, cobalt, airy, soft shadows",
    swatch: ["#f1f3f8", "#ffffff", "#1a2033", "#2f5bea"],
    light: true,
  },
  forest: {
    id: "forest",
    name: "Deep forest",
    blurb: "Mid-tone green, apricot, serif headings",
    swatch: ["#1c3733", "#234440", "#f2efe6", "#ffb174"],
    light: false,
  },
};

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function asTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}
