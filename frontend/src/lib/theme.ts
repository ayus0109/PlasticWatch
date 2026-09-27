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
  low: "#5A6E63",
  medium: "#D97706",
  high: "#EA580C",
  critical: "#C53030",
} as const;
export type BandKey = keyof typeof band;

/** Tinted chip surfaces derived from the ramp. Meaning still comes from the label. */
export const bandChip: Record<ThemeMode, Record<BandKey, { bg: string; fg: string; line: string }>> = {
  light: {
    low: { bg: "#F1F5F2", fg: "#2E4237", line: "#D2DDD6" },
    medium: { bg: "#FEF3C7", fg: "#92400E", line: "#FDE68A" },
    high: { bg: "#FFEDD5", fg: "#9A3412", line: "#FED7AA" },
    critical: { bg: "#FEE2E2", fg: "#991B1B", line: "#FECACA" },
  },
  dark: {
    low: { bg: "rgba(90, 110, 99, 0.22)", fg: "#D2DDD6", line: "rgba(90, 110, 99, 0.45)" },
    medium: { bg: "rgba(217, 119, 6, 0.2)", fg: "#FDE68A", line: "rgba(217, 119, 6, 0.45)" },
    high: { bg: "rgba(234, 88, 12, 0.2)", fg: "#FED7AA", line: "rgba(234, 88, 12, 0.45)" },
    critical: { bg: "rgba(197, 48, 48, 0.22)", fg: "#FECACA", line: "rgba(197, 48, 48, 0.45)" },
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
    bg: "#FAF8F5",
    surface: "#FFFFFF",
    surface2: "#F3EFEA",
    border: "#E2DDD5",
    borderStrong: "#C9C2B5",
    text: "#14241C",
    muted: "#3D4F44",
    faint: "#6B7D72",
    accent: "#267338",
    accentHover: "#1E5C2C",
    accentSoft: "#EAF4ED",
    accentFg: "#FFFFFF",
    link: "#1B636E",
    linkSoft: "#E3F1F3",
    simBg: "#FEF3C7",
    simFg: "#92400E",
    simBorder: "#D97706",
    ok: "#267338",
    okSoft: "#EAF4ED",
    danger: "#C53030",
    dangerSoft: "#FEE2E2",
    info: "#1B636E",
    infoSoft: "#E3F1F3",
    mapWater: "#2B7A87",
    mapDrain: "#3D919F",
    overlay: "rgba(20, 36, 28, 0.45)",
  },
  dark: {
    bg: "#0D1812",
    surface: "#14241C",
    surface2: "#1C3328",
    border: "#2A4537",
    borderStrong: "#3B5C4B",
    text: "#F1F5F2",
    muted: "#A3B8AC",
    faint: "#6E8578",
    accent: "#38A169",
    accentHover: "#48BB78",
    accentSoft: "rgba(56, 161, 105, 0.18)",
    accentFg: "#FFFFFF",
    link: "#4FD1C5",
    linkSoft: "rgba(79, 209, 197, 0.16)",
    simBg: "rgba(217, 119, 6, 0.18)",
    simFg: "#FCD34D",
    simBorder: "#B45309",
    ok: "#38A169",
    okSoft: "rgba(56, 161, 105, 0.18)",
    danger: "#E53E3E",
    dangerSoft: "rgba(229, 62, 62, 0.18)",
    info: "#319795",
    infoSoft: "rgba(49, 151, 149, 0.18)",
    mapWater: "#285E61",
    mapDrain: "#319795",
    overlay: "rgba(13, 24, 18, 0.72)",
  },
};

export const series = {
  light: {
    opened: "#1B636E",
    resolved: "#267338",
  },
  dark: {
    opened: "#319795",
    resolved: "#38A169",
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
