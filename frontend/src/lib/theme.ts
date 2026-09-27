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

/** Priority ramp — grounded earth tones matching the monument silhouette and civic urgency. */
export const band = {
  low: "#5e7166",
  medium: "#d97706", // warm saffron / amber
  high: "#d9531e",   // terracotta
  critical: "#b91c1c", // deep crimson
} as const;
export type BandKey = keyof typeof band;

/** Tinted chip surfaces derived from the ramp. */
export const bandChip: Record<ThemeMode, Record<BandKey, { bg: string; fg: string; line: string }>> = {
  light: {
    low: { bg: "#f3ede3", fg: "#35443b", line: "#d5cdbf" },
    medium: { bg: "#fffbeb", fg: "#92400e", line: "#fde68a" },
    high: { bg: "#fff7ed", fg: "#9a3412", line: "#fed7aa" },
    critical: { bg: "#fef2f2", fg: "#991b1b", line: "#fecaca" },
  },
  dark: {
    low: { bg: "rgba(94, 113, 102, 0.2)", fg: "#cbdcd0", line: "rgba(94, 113, 102, 0.45)" },
    medium: { bg: "rgba(217, 119, 6, 0.18)", fg: "#fde68a", line: "rgba(217, 119, 6, 0.45)" },
    high: { bg: "rgba(217, 83, 30, 0.2)", fg: "#fdba74", line: "rgba(217, 83, 30, 0.45)" },
    critical: { bg: "rgba(185, 28, 28, 0.22)", fg: "#fca5a5", line: "rgba(185, 28, 28, 0.5)" },
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
    // Warm natural cream / ivory from the image center
    bg: "#fbf8f3",
    surface: "rgba(255, 255, 255, 0.95)",
    surface2: "#f3ede3",
    border: "#e3ddd2",
    borderStrong: "#cbc1b3",
    // Deep forest slate ink — high contrast readability
    text: "#14241c",
    muted: "#3f5446",
    faint: "#6b8073",
    // Natural botanical leaf green from the PNG (no electric neon)
    accent: "#267338",
    accentHover: "#1b592a",
    accentSoft: "#edf7ee",
    accentFg: "#ffffff",
    // Calm aquatic river teal instead of harsh cyan
    link: "#1b636e",
    linkSoft: "#e6f5f7",
    // Saffron from the monument skyline & top wave
    simBg: "#fff8ee",
    simFg: "#9a3412",
    simBorder: "#f59e0b",
    ok: "#267338",
    okSoft: "#edf7ee",
    danger: "#c5221f",
    dangerSoft: "#fdf2f2",
    info: "#1b636e",
    infoSoft: "#e6f5f7",
    mapWater: "#267e8c",
    mapDrain: "#3d99a7",
    overlay: "rgba(20, 36, 28, 0.45)",
  },
  dark: {
    // Deep evergreen night tone
    bg: "#0c1812",
    surface: "rgba(18, 32, 25, 0.94)",
    surface2: "#182c20",
    border: "#254030",
    borderStrong: "#355943",
    text: "#f0fdf4",
    muted: "#a1b8aa",
    faint: "#688273",
    // Organic foliage green (calm, never neon)
    accent: "#4caf60",
    accentHover: "#5ecb73",
    accentSoft: "rgba(76, 175, 96, 0.16)",
    accentFg: "#071f11",
    link: "#3da7b4",
    linkSoft: "rgba(61, 167, 180, 0.15)",
    simBg: "rgba(217, 119, 6, 0.16)",
    simFg: "#fbbf24",
    simBorder: "#b45309",
    ok: "#4caf60",
    okSoft: "rgba(76, 175, 96, 0.15)",
    danger: "#ef4444",
    dangerSoft: "rgba(239, 68, 68, 0.18)",
    info: "#3da7b4",
    infoSoft: "rgba(61, 167, 180, 0.15)",
    mapWater: "#3da7b4",
    mapDrain: "#5fc4d1",
    overlay: "rgba(4, 12, 8, 0.7)",
  },
};

/**
 * Chart tokens derived from eco green and warm saffron.
 */
export const chart: Record<
  ThemeMode,
  { series1: string; series2: string; grid: string; axis: string; ink: string; muted: string; surface: string }
> = {
  light: {
    series1: "#267338", // botanical green
    series2: "#d97706", // warm saffron
    grid: "#e5ded4",
    axis: "#cec4b6",
    ink: "#14241c",
    muted: "#6b8073",
    surface: "#ffffff",
  },
  dark: {
    series1: "#4caf60",
    series2: "#fbbf24",
    grid: "#203629",
    axis: "#2d4d3a",
    ink: "#f0fdf4",
    muted: "#8ca797",
    surface: "#122019",
  },
};

/** Spacing scale in px. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

/** Corner radii in px. */
export const radius = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

/**
 * Atmosphere tokens harmonized with the India ecological theme.
 */
export const waves: Record<ThemeMode, { horizon: string; wave: string; crest: string; opacity: number }> = {
  light: { horizon: "#f3ede3", wave: "#267338", crest: "#d97706", opacity: 0.35 },
  dark: { horizon: "#182c20", wave: "#254030", crest: "#4caf60", opacity: 0.45 },
};

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
