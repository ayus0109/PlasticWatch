import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Icon } from "./Icon";
import { applyTheme, currentTheme, type ThemeMode } from "../lib/theme";
import { Logo } from "./Shell";
import { cx } from "./ui";

interface HamburgerMenuProps {
  onDark?: boolean;
  className?: string;
  showSignInButton?: boolean;
}

export function HamburgerMenu({
  onDark = false,
  className = "",
  showSignInButton = true,
}: HamburgerMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>(currentTheme());
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click or Escape key
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Listen to external theme changes
  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<ThemeMode>;
      if (customEvent.detail) {
        setMode(customEvent.detail);
      }
    };
    window.addEventListener("pw-theme", handleThemeChange);
    return () => window.removeEventListener("pw-theme", handleThemeChange);
  }, []);

  const flipTheme = () => {
    const next = mode === "dark" ? "light" : "dark";
    applyTheme(next);
    setMode(next);
    window.dispatchEvent(new CustomEvent("pw-theme", { detail: next }));
  };

  const handleLoginClick = (role?: "citizen" | "authority") => {
    setOpen(false);
    if (role) {
      navigate(`/login?role=${role}`);
    } else {
      navigate("/login");
    }
  };

  return (
    <>
      <div className={cx("relative flex items-center gap-2", className)} ref={menuRef}>
        {/* Quick Nav Sign In Button (optional) */}
        {showSignInButton && (
          <button
            type="button"
            onClick={() => handleLoginClick()}
            className={cx(
              "inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] rounded-field text-xs sm:text-sm font-bold shadow-sm transition-all duration-150 active:scale-95",
              onDark
                ? "bg-accent text-accent-fg hover:bg-accent/90"
                : "bg-accent text-accent-fg hover:bg-accent/90",
            )}
          >
            <Icon name="shield" size={15} />
            Sign In
          </button>
        )}

        {/* Hamburger Corner Button */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="true"
          aria-label="Open navigation menu"
          className={cx(
            "grid h-10 w-10 place-items-center rounded-field border transition-all duration-150 active:scale-95",
            open
              ? "border-accent bg-accent-soft text-accent shadow-sm"
              : onDark
              ? "border-white/30 bg-white/10 text-white hover:bg-white/20 hover:border-white/50"
              : "border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2",
          )}
        >
          <Icon name={open ? "x" : "menu"} size={20} />
        </button>

        {/* Hamburger Dropdown Panel */}
        {open && (
          <div
            role="menu"
            className="absolute right-0 top-12 z-[1100] w-72 overflow-hidden rounded-card border border-line bg-surface p-2.5 shadow-pop animate-rise"
          >
            {/* Menu Header */}
            <div className="flex items-center justify-between border-b border-line px-2.5 pb-2.5 pt-1">
              <div className="flex items-center gap-2">
                <Logo compact size="sm" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted">
                  Menu
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="x" size={14} />
              </button>
            </div>

            {/* ONLY: About & Theme Mode */}
            <div className="mt-2 space-y-1">
              {/* About Button */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setAboutOpen(true);
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-field px-3 text-left text-xs font-medium text-ink hover:bg-surface-2 transition-colors"
              >
                <span className="grid h-7 w-7 place-items-center rounded-field bg-surface-2 text-accent">
                  <Icon name="info" size={16} />
                </span>
                <span className="flex-1">
                  <span className="block font-semibold">About PlasticWatch</span>
                  <span className="block text-[11px] text-muted">
                    Ethical mission, AI-GIS & SDGs 11, 12, 14
                  </span>
                </span>
                <Icon name="chevronRight" size={14} className="text-faint" />
              </button>

              {/* Dark / Light Mode Option */}
              <button
                type="button"
                role="menuitem"
                onClick={flipTheme}
                className="flex min-h-11 w-full items-center gap-3 rounded-field px-3 text-left text-xs font-medium text-ink hover:bg-surface-2 transition-colors"
              >
                <span className="grid h-7 w-7 place-items-center rounded-field bg-surface-2 text-accent">
                  <Icon name={mode === "dark" ? "sun" : "moon"} size={16} />
                </span>
                <span className="flex-1">
                  <span className="block font-semibold">Theme Mode</span>
                  <span className="block text-[11px] text-muted">
                    Currently in {mode === "dark" ? "Dark mode" : "Light mode"}
                  </span>
                </span>
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-semibold text-muted">
                  Toggle
                </span>
              </button>
            </div>

            {/* Footer Attribution strip */}
            <div className="mt-2 border-t border-line px-2.5 pt-2 text-[10px] text-faint flex items-center justify-between">
              <span>PlasticWatch v1.0</span>
              <span>UN SDGs 11 · 12 · 14</span>
            </div>
          </div>
        )}
      </div>

      {/* ABOUT MODAL */}
      {aboutOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[1200] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm animate-rise"
        >
          <div className="relative w-full max-w-lg rounded-panel border border-line bg-surface p-6 shadow-pop">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2.5">
                <Logo compact size="sm" />
                <div>
                  <h3 className="text-base font-bold text-ink">About PlasticWatch</h3>
                  <p className="text-micro text-muted">AI-GIS Urban Waterway Intelligence</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs text-ink leading-relaxed">
              <div className="rounded-field border border-accent/30 bg-accent-soft p-3 text-ink">
                <div className="font-semibold text-accent mb-0.5 flex items-center gap-1.5">
                  <Icon name="shield" size={14} />
                  Core Ethical Law (Non-Attribution)
                </div>
                Reports show waste is present — <strong>never who is responsible</strong>.
                Nothing is verified or resolved until a human municipal authority confirms it.
                The AI model prioritizes hotpots; it never has the final word.
              </div>

              <div>
                <h4 className="font-bold text-ink mb-1">Dual-Engine AI Detection</h4>
                <p className="text-muted">
                  Ultralytics YOLO neural network trained on open datasets identifies plastic bottles,
                  bags, film, and packaging, paired with an OpenCV contour saliency engine for
                  crushed and fragmented debris.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-ink mb-1">PostGIS Spatio-Temporal Clustering</h4>
                <p className="text-muted">
                  Autonomous spatial clustering merges multiple proximate citizen reports within 25m
                  into living hotspots, ranked by ecological urgency based on proximity to storm drains,
                  lakes, and urban water bodies.
                </p>
              </div>

              <div className="rounded-field border border-line bg-surface-2 p-3">
                <h4 className="font-bold text-ink mb-1.5">UN Sustainable Development Goals</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-muted">
                  <div className="rounded border border-line bg-surface p-2">
                    <strong className="block text-ink">SDG 11</strong>
                    Sustainable Cities
                  </div>
                  <div className="rounded border border-line bg-surface p-2">
                    <strong className="block text-ink">SDG 12</strong>
                    Responsible Consumption
                  </div>
                  <div className="rounded border border-line bg-surface p-2">
                    <strong className="block text-ink">SDG 14</strong>
                    Life Below Water
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="rounded-field bg-surface-2 border border-line px-4 py-2 text-xs font-semibold text-ink hover:bg-surface transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
