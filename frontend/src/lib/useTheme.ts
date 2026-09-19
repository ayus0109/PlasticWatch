import { useEffect, useState } from "react";
import { currentTheme, type ThemeMode } from "./theme";

/** The current theme mode, re-rendering when the user flips it (ThemeToggle fires "pw-theme"). */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(currentTheme());
  useEffect(() => {
    const on = () => setMode(currentTheme());
    window.addEventListener("pw-theme", on);
    return () => window.removeEventListener("pw-theme", on);
  }, []);
  return mode;
}
