import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Icon, type IconName } from "./Icon";
import { applyTheme, currentTheme, type ThemeMode } from "../lib/theme";
import { logout, useSession } from "../store/auth";
import { Logo } from "./Shell";
import { cx } from "./ui";

interface HamburgerMenuProps {
  onDark?: boolean;
  className?: string;
  /** The landing page offers Login here, and ONLY here. The login page itself doesn't. */
  showLogin?: boolean;
}

function MenuItem({
  icon,
  title,
  hint,
  onClick,
  trailing,
  tone = "default",
}: {
  icon: IconName;
  title: string;
  hint?: string;
  onClick: () => void;
  trailing?: React.ReactNode;
  tone?: "default" | "accent";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx(
        "flex min-h-12 w-full items-center gap-3 rounded-field px-3 py-2 text-left transition-colors",
        tone === "accent" ? "bg-accent text-accent-fg hover:bg-accent-hover" : "text-ink hover:bg-surface-2",
      )}
    >
      <span
        className={cx(
          "grid h-9 w-9 shrink-0 place-items-center rounded-field",
          tone === "accent" ? "bg-black/15" : "bg-surface-2 text-accent",
        )}
      >
        <Icon name={icon} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        {hint ? (
          <span className={cx("block text-xs", tone === "accent" ? "opacity-85" : "text-muted")}>
            {hint}
          </span>
        ) : null}
      </span>
      {trailing}
    </button>
  );
}

export function HamburgerMenu({ onDark = false, className = "", showLogin = true }: HamburgerMenuProps) {
  const navigate = useNavigate();
  const session = useSession();
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

  return (
    <>
      <div className={cx("relative", className)} ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="true"
          aria-label={open ? "Close menu" : "Open menu"}
          className={cx(
            "grid h-11 w-11 place-items-center rounded-field border transition-all duration-150 active:scale-95",
            open
              ? "border-accent bg-accent-soft text-accent shadow-sm"
              : onDark
                ? "border-white/30 bg-white/10 text-white hover:border-white/50 hover:bg-white/20"
                : "border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2",
          )}
        >
          <Icon name={open ? "x" : "menu"} size={22} />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-14 z-[1100] w-[min(18rem,calc(100vw-2rem))] space-y-1 rounded-card border border-line bg-surface p-2 shadow-pop animate-rise"
          >
            {session ? null : showLogin ? (
              <MenuItem
                icon="shield"
                title="Login"
                hint="Citizen or government account"
                tone="accent"
                onClick={() => {
                  setOpen(false);
                  navigate("/login");
                }}
              />
            ) : null}

            <MenuItem
              icon="info"
              title="About"
              hint="What PlasticWatch does"
              onClick={() => {
                setOpen(false);
                setAboutOpen(true);
              }}
            />

            <MenuItem
              icon={mode === "dark" ? "sun" : "moon"}
              title={mode === "dark" ? "Light mode" : "Dark mode"}
              hint={`Now using ${mode} mode`}
              onClick={flipTheme}
            />

            {session ? (
              <MenuItem
                icon="logout"
                title="Log out"
                hint={session.user.email ?? session.user.name}
                onClick={() => {
                  setOpen(false);
                  logout();
                  navigate("/");
                }}
              />
            ) : null}
          </div>
        )}
      </div>

      {/* ABOUT MODAL */}
      {aboutOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="About PlasticWatch"
          className="fixed inset-0 z-[1200] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm animate-rise"
        >
          <div className="relative w-full max-w-lg rounded-panel border border-line bg-surface p-6 shadow-pop">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2.5">
                <Logo compact size="sm" />
                <div>
                  <h3 className="text-lg font-bold text-ink">About PlasticWatch</h3>
                  <p className="text-xs text-muted">AI-GIS Urban Waterway Intelligence</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                aria-label="Close"
                className="grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-sm leading-relaxed text-ink">
              <div className="rounded-field border border-accent/30 bg-accent-soft p-3 text-ink">
                <div className="mb-0.5 flex items-center gap-1.5 font-semibold text-accent">
                  <Icon name="shield" size={15} />
                  Core Ethical Law (Non-Attribution)
                </div>
                Reports show waste is present — <strong>never who is responsible</strong>.
                Nothing is verified or resolved until a human municipal authority confirms it.
                The AI model prioritizes hotspots; it never has the final word.
              </div>

              <div>
                <h4 className="mb-1 font-bold text-ink">Dual-Engine AI Detection</h4>
                <p className="text-muted">
                  Ultralytics YOLO neural network trained on open datasets identifies plastic bottles,
                  bags, film, and packaging, paired with an OpenCV contour saliency engine for
                  crushed and fragmented debris.
                </p>
              </div>

              <div>
                <h4 className="mb-1 font-bold text-ink">PostGIS Spatio-Temporal Clustering</h4>
                <p className="text-muted">
                  Autonomous spatial clustering merges multiple proximate citizen reports within 25m
                  into living hotspots, ranked by ecological urgency based on proximity to storm drains,
                  lakes, and urban water bodies.
                </p>
              </div>

              <div className="rounded-field border border-line bg-surface-2 p-3">
                <h4 className="mb-1.5 font-bold text-ink">UN Sustainable Development Goals</h4>
                <div className="grid grid-cols-1 gap-2 text-xs text-muted sm:grid-cols-3">
                  <div className="rounded border border-line bg-surface p-2">
                    <strong className="block text-sm text-ink">SDG 11</strong>
                    Sustainable Cities
                  </div>
                  <div className="rounded border border-line bg-surface p-2">
                    <strong className="block text-sm text-ink">SDG 12</strong>
                    Responsible Consumption
                  </div>
                  <div className="rounded border border-line bg-surface p-2">
                    <strong className="block text-sm text-ink">SDG 14</strong>
                    Life Below Water
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="min-h-11 rounded-field border border-line bg-surface-2 px-5 text-sm font-semibold text-ink transition-colors hover:bg-surface"
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
