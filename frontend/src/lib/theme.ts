/**
 * Design tokens — the single source of truth (CLAUDE.md §9).
 *
 * applyTheme() writes these as CSS variables on <html>; index.css maps Tailwind
 * utilities onto the variables (bg-surface, text-muted, …) and the Leaflet map reads
 * the same values from here. So a chip, a marker and a chart can never disagree.
 *
 * Direction: neutral canvas, one confident accent (teal — water, SDG 14), data does
 * the talking. The 4-step priority ramp is fixed by CLAUDE.md §9 and is the ONLY
 * warm colour family in the UI, so a red thing always means "critical".
 */

export type ThemeMode = "light" | "dark";

/** Priority ramp (CLAUDE.md §9). Same in light and dark: meaning must not shift. */
export const band = {
  low: "#64748b",
  medium: "#f59e0b",
  high: "#f97316",
  critical: "#ef4444",
} as const;
export type BandKey = keyof typeof band;

interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  accentFg: string;
  simBg: string;
  simFg: string;
  simBorder: string;
  ok: string;
  okSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  mapWater: string;
  mapDrain: string;
  overlay: string;
}

export const palette: Record<ThemeMode, Palette> = {
  light: {
    bg: "#f5f5f2",
    surface: "#ffffff",
    surface2: "#efeee9",
    border: "#e3e1db",
    borderStrong: "#cfccc3",
    text: "#1b1a17",
    muted: "#65625b",
    faint: "#9a968d",
    accent: "#0f766e",
    accentHover: "#0b5f58",
    accentSoft: "#d5f2ee",
    accentFg: "#ffffff",
    simBg: "#fff7e0",
    simFg: "#8a4b00",
    simBorder: "#e0a400",
    ok: "#15803d",
    okSoft: "#dcf4e3",
    danger: "#b91c1c",
    dangerSoft: "#fde4e4",
    info: "#1d4ed8",
    infoSoft: "#e0e9ff",
    mapWater: "#2563eb",
    mapDrain: "#0ea5e9",
    overlay: "rgba(20, 18, 14, 0.42)",
  },
  dark: {
    bg: "#0d0f12",
    surface: "#15181d",
    surface2: "#1c2027",
    border: "#262b33",
    borderStrong: "#363c46",
    text: "#ecebe7",
    muted: "#a3a19a",
    faint: "#6f6d67",
    accent: "#2dd4bf",
    accentHover: "#5eead4",
    accentSoft: "rgba(45, 212, 191, 0.14)",
    accentFg: "#04221e",
    simBg: "rgba(245, 158, 11, 0.12)",
    simFg: "#fcd34d",
    simBorder: "#b98100",
    ok: "#4ade80",
    okSoft: "rgba(74, 222, 128, 0.12)",
    danger: "#f87171",
    dangerSoft: "rgba(248, 113, 113, 0.13)",
    info: "#93b4ff",
    infoSoft: "rgba(147, 180, 255, 0.13)",
    mapWater: "#60a5fa",
    mapDrain: "#38bdf8",
    overlay: "rgba(0, 0, 0, 0.6)",
  },
};

/**
 * Chart tokens. The two categorical series slots are COOL hues on purpose: warm
 * colours are reserved for the priority ramp. Validated with the dataviz skill's
 * validate_palette.js against each mode's real surface (all checks PASS):
 *   light #0aa595 / #6d5bd0 on #ffffff — worst CVD dE 19.7, normal dE 24.9
 *   dark  #0d9b8d / #9085e9 on #15181d — worst CVD dE 13.2, normal dE 20.6
 * Slot order is fixed: series1 = "opened / open", series2 = "resolved", everywhere.
 */
export const chart: Record<
  ThemeMode,
  { series1: string; series2: string; grid: string; axis: string; ink: string; muted: string; surface: string }
> = {
  light: {
    series1: "#0aa595",
    series2: "#6d5bd0",
    grid: "#ebe9e4",
    axis: "#cfccc3",
    ink: "#1b1a17",
    muted: "#8a867d",
    surface: "#ffffff",
  },
  dark: {
    series1: "#0d9b8d",
    series2: "#9085e9",
    grid: "#23272e",
    axis: "#363c46",
    ink: "#ecebe7",
    muted: "#8d8b85",
    surface: "#15181d",
  },
};

/** Spacing scale in px (Tailwind's 4 px grid; named here so JS layouts match). */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

/** Corner radii in px. */
export const radius = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

/** Elevation. Kept soft: data, not chrome, should stand out. */
export const shadow = {
  card: "0 1px 2px rgba(16, 15, 12, 0.05), 0 1px 1px rgba(16, 15, 12, 0.03)",
  raised: "0 6px 18px -6px rgba(16, 15, 12, 0.18), 0 2px 4px rgba(16, 15, 12, 0.05)",
  pop: "0 18px 40px -12px rgba(16, 15, 12, 0.32)",
} as const;

/** Minimum hit target (CLAUDE.md §9 accessibility). */
export const HIT_TARGET_PX = 40;

const THEME_KEY = "pw-theme";

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(palette[mode])) {
    root.style.setProperty(`--pw-${kebab(key)}`, value);
  }
  for (const [key, value] of Object.entries(band)) {
    root.style.setProperty(`--pw-band-${key}`, value);
  }
  root.style.setProperty("--pw-shadow-card", shadow.card);
  root.style.setProperty("--pw-shadow-raised", shadow.raised);
  root.style.setProperty("--pw-shadow-pop", shadow.pop);
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", palette[mode].bg);
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* storage unavailable (private mode) — the theme still applies for this visit */
  }
}

export function initialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function currentTheme(): ThemeMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
