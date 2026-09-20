/**
 * Design tokens — the single source of truth (CLAUDE.md §9).
 *
 * applyTheme() writes these as CSS variables on <html>; index.css maps Tailwind
 * utilities onto the variables (bg-surface, text-muted, …) and the Leaflet map reads
 * the same values from here. So a chip, a marker and a chart can never disagree.
 *
 * Direction: an eco-GIS canvas — slate neutrals, deep ocean teal for actions and a
 * river blue for links, data does the talking. The 4-step priority ramp is fixed by
 * CLAUDE.md §9 and is the ONLY warm colour family in the UI, so a red thing always
 * means "critical". `bandChip` below is a SURFACE treatment of that same ramp (tinted
 * background + readable ink): chips read calmly at small sizes while markers, score
 * bars and the heatmap keep the exact ramp hues.
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

/** Tinted chip surfaces derived from the ramp. Meaning still comes from the label. */
export const bandChip: Record<ThemeMode, Record<BandKey, { bg: string; fg: string; line: string }>> = {
  light: {
    low: { bg: "#f1f5f9", fg: "#334155", line: "#cbd5e1" },
    medium: { bg: "#fffbeb", fg: "#92400e", line: "#fde68a" },
    high: { bg: "#fff7ed", fg: "#9a3412", line: "#fed7aa" },
    critical: { bg: "#fff1f2", fg: "#9f1239", line: "#fecdd3" },
  },
  dark: {
    low: { bg: "rgba(148, 163, 184, 0.14)", fg: "#cbd5e1", line: "rgba(148, 163, 184, 0.35)" },
    medium: { bg: "rgba(245, 158, 11, 0.14)", fg: "#fcd34d", line: "rgba(245, 158, 11, 0.38)" },
    high: { bg: "rgba(249, 115, 22, 0.15)", fg: "#fdba74", line: "rgba(249, 115, 22, 0.4)" },
    critical: { bg: "rgba(239, 68, 68, 0.16)", fg: "#fca5a5", line: "rgba(239, 68, 68, 0.42)" },
  },
};

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
  link: string;
  linkSoft: string;
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
    bg: "#f8fafc",
    surface: "#ffffff",
    surface2: "#f1f5f9",
    border: "#e2e8f0",
    borderStrong: "#cbd5e1",
    text: "#0f172a",
    muted: "#475569",
    faint: "#94a3b8",
    accent: "#0d9488",
    accentHover: "#0f766e",
    accentSoft: "#ccfbf1",
    accentFg: "#ffffff",
    link: "#0284c7",
    linkSoft: "#e0f2fe",
    simBg: "#fffbeb",
    simFg: "#92400e",
    simBorder: "#fbbf24",
    ok: "#059669",
    okSoft: "#d1fae5",
    danger: "#e11d48",
    dangerSoft: "#ffe4e6",
    info: "#0284c7",
    infoSoft: "#e0f2fe",
    mapWater: "#0284c7",
    mapDrain: "#38bdf8",
    overlay: "rgba(15, 23, 42, 0.45)",
  },
  dark: {
    bg: "#020617",
    surface: "#0f172a",
    surface2: "#1e293b",
    border: "#243044",
    borderStrong: "#334155",
    text: "#e2e8f0",
    muted: "#94a3b8",
    faint: "#64748b",
    accent: "#2dd4bf",
    accentHover: "#5eead4",
    accentSoft: "rgba(45, 212, 191, 0.15)",
    accentFg: "#042f2e",
    link: "#38bdf8",
    linkSoft: "rgba(56, 189, 248, 0.15)",
    simBg: "rgba(245, 158, 11, 0.13)",
    simFg: "#fcd34d",
    simBorder: "#b45309",
    ok: "#34d399",
    okSoft: "rgba(52, 211, 153, 0.14)",
    danger: "#fb7185",
    dangerSoft: "rgba(251, 113, 133, 0.14)",
    info: "#38bdf8",
    infoSoft: "rgba(56, 189, 248, 0.14)",
    mapWater: "#38bdf8",
    mapDrain: "#7dd3fc",
    overlay: "rgba(2, 6, 23, 0.66)",
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
  card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.04)",
  raised: "0 8px 20px -8px rgba(15, 23, 42, 0.16), 0 2px 6px rgba(15, 23, 42, 0.05)",
  pop: "0 20px 44px -14px rgba(15, 23, 42, 0.34)",
} as const;

/** Minimum hit target: 44 px, the iOS/Android touch standard (CLAUDE.md §9). */
export const HIT_TARGET_PX = 44;

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
  for (const [key, chip] of Object.entries(bandChip[mode])) {
    root.style.setProperty(`--pw-band-${key}-bg`, chip.bg);
    root.style.setProperty(`--pw-band-${key}-fg`, chip.fg);
    root.style.setProperty(`--pw-band-${key}-line`, chip.line);
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
