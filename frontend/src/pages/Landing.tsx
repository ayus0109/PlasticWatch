import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { PublicSummary } from "../api/client";
import { useApi } from "../api/hooks";
import { Icon } from "../components/Icon";
import { Logo } from "../components/Shell";
import { applyTheme, currentTheme, type ThemeMode } from "../lib/theme";
import { homeFor, useSession } from "../store/auth";

const HERO_TILES: { key: keyof PublicSummary; label: string; hint: string }[] = [
  { key: "active_hotspots", label: "Active hotspots", hint: "open and tracked" },
  { key: "awaiting_verification", label: "Awaiting review", hint: "queued for a person" },
  { key: "total_reports", label: "Citizen reports", hint: "photos submitted" },
  { key: "resolved_hotspots", label: "Resolved", hint: "closed by an authority" },
];

export default function Landing() {
  const session = useSession();
  const navigate = useNavigate();
  const stats = useApi<PublicSummary>("/analytics/public");

  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>(currentTheme());
  const menuRef = useRef<HTMLDivElement>(null);

  // Close hamburger dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpen]);

  const flipTheme = () => {
    const next = mode === "dark" ? "light" : "dark";
    applyTheme(next);
    setMode(next);
    window.dispatchEvent(new CustomEvent("pw-theme", { detail: next }));
  };

  return (
    <div className="relative min-h-full">
      {/* ----------------------------------------------------------------- Hero ---- */}
      <section className="relative isolate overflow-hidden text-white min-h-[92vh] flex flex-col justify-between">
        {/* Underlay tone */}
        <div aria-hidden className="absolute inset-0 -z-30 bg-[#042019]" />

        {/* Background waterway photograph */}
        <div
          aria-hidden
          className="absolute inset-0 -z-20 bg-cover bg-center bg-no-repeat transition-all duration-700"
          style={{ backgroundImage: "url('/hero-waterway.jpg')" }}
        />

        {/* Semi-transparent scrim for high contrast and readability */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(108deg, rgba(4, 38, 28, 0.88) 0%, rgba(4, 38, 28, 0.72) 42%, rgba(6, 60, 48, 0.40) 78%, rgba(15, 23, 42, 0.52) 100%)",
          }}
        />

        {/* Vertical vignette to anchor bottom cards */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(180deg, rgba(0, 0, 0, 0.25) 0%, transparent 45%, rgba(4, 25, 20, 0.65) 100%)",
          }}
        />

        {/* Top Navigation Bar: Logo on Left, Login + Hamburger side-by-side on Right */}
        <header className="relative z-30 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-6 sm:px-8">
          <Logo onDark size="lg" />

          <div ref={menuRef} className="flex items-center gap-2.5 sm:gap-3">
            {/* Primary Login Button (arranged side by side with hamburger menu) */}
            {session ? (
              <button
                type="button"
                onClick={() => navigate(homeFor(session.user.role))}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-field bg-accent px-4 py-2 text-sm font-semibold text-accent-fg shadow-sm transition-all duration-150 hover:opacity-95 hover:shadow-raised active:scale-[0.98] cursor-pointer"
              >
                <Icon name="arrowRight" size={16} />
                <span>Go to App</span>
              </button>
            ) : (
              <Link
                to="/login"
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-field bg-accent px-4 py-2 text-sm font-semibold text-accent-fg shadow-sm transition-all duration-150 hover:opacity-95 hover:shadow-raised active:scale-[0.98] cursor-pointer"
              >
                <Icon name="lock" size={15} />
                <span>Login</span>
              </Link>
            )}

            {/* Hamburger Corner Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label="Open menu"
                aria-expanded={menuOpen}
                className="grid h-[38px] w-[38px] place-items-center rounded-field border border-white/30 bg-white/10 text-white backdrop-blur-sm transition-all duration-150 hover:bg-white/20 active:scale-95 cursor-pointer"
              >
                <Icon name={menuOpen ? "x" : "menu"} size={19} />
              </button>

              {/* Hamburger Dropdown Drawer / Menu */}
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-12 z-50 w-72 overflow-hidden rounded-card border border-line bg-surface p-2 shadow-pop animate-rise text-ink"
                >
                  {/* Quick Role Portal access */}
                  <div className="rounded-field border border-line/60 bg-surface-2 p-3">
                    <span className="block text-micro font-bold uppercase tracking-wider text-accent">
                      Portal Access
                    </span>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Link
                        to="/login?role=citizen"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center justify-center gap-1.5 rounded-field bg-accent px-2.5 py-2 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 text-center"
                      >
                        <Icon name="camera" size={13} />
                        Citizen
                      </Link>
                      <Link
                        to="/login?role=authority"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center justify-center gap-1.5 rounded-field border border-line bg-surface px-2.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-accent hover:text-accent text-center"
                      >
                        <Icon name="shield" size={13} />
                        Govt
                      </Link>
                    </div>
                  </div>

                  <div className="my-1.5 border-t border-line" />

                  {/* About Button */}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setAboutOpen(true);
                    }}
                    className="flex min-h-11 w-full items-center justify-between rounded-field px-3 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-2 cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon name="info" size={17} className="text-accent" />
                      About PlasticWatch
                    </span>
                    <Icon name="arrowRight" size={15} className="text-muted" />
                  </button>

                  {/* Dark / Light Mode Toggle */}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      flipTheme();
                    }}
                    className="flex min-h-11 w-full items-center justify-between rounded-field px-3 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-2 cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon name={mode === "dark" ? "sun" : "moon"} size={17} className="text-accent" />
                      <span>{mode === "dark" ? "Light Mode" : "Dark Mode"}</span>
                    </span>
                    <span className="text-xs text-muted">Switch</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Hero Content */}
        <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 md:py-12">
          <div className="animate-rise max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/25 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
              Municipal GIS & AI Waste Triage System
            </div>

            <h1 className="font-display mt-5 text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl md:text-5xl drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
              AI and GIS for urban waterway and waste intelligence
            </h1>

            <p className="mt-4 text-body leading-relaxed text-white/90 drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
              Citizens photograph likely plastic waste. Duplicate reports merge into hotspots,
              ranked by impact near drains and water — then a person, not the model, decides
              what happens next.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/login?role=citizen"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-field bg-accent px-5 text-label font-semibold text-accent-fg transition-transform duration-150 hover:-translate-y-px active:translate-y-0 active:scale-[0.98] shadow-md cursor-pointer"
              >
                <Icon name="camera" size={17} />
                Sign in to report waste
              </Link>
              <Link
                to="/login?role=authority"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-field border border-white/30 bg-white/10 px-5 text-label font-semibold text-white backdrop-blur-sm transition-[transform,background-color] duration-150 hover:-translate-y-px hover:bg-white/20 active:translate-y-0 active:scale-[0.98] cursor-pointer"
              >
                <Icon name="shield" size={17} />
                Sign in as authority
              </Link>
            </div>
          </div>

          {/* Live public municipal counts */}
          <div className="mt-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {HERO_TILES.map((t) => {
              const value = stats.data ? (stats.data[t.key] as number) : null;
              return (
                <div
                  key={t.key}
                  className="rounded-card border border-white/20 bg-black/30 p-4 backdrop-blur-md shadow-md"
                >
                  <div className="text-micro font-semibold text-white/70">{t.label}</div>
                  <div className="font-display tabular mt-1.5 text-display font-bold">
                    {stats.loading ? (
                      <span className="inline-block h-7 w-16 animate-pulse rounded-field bg-white/25" />
                    ) : value === null ? (
                      "—"
                    ) : (
                      value.toLocaleString()
                    )}
                  </div>
                  <div className="mt-1 text-micro text-white/65">{t.hint}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Subtle bottom buffer */}
        <div className="h-6" />
      </section>

      {/* ------------------------------------------------------------- Workflow ---- */}
      <section className="border-t border-line bg-surface py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Closed-Loop Municipal Sanitation Workflow
            </h2>
            <p className="mt-2 text-sm text-muted">
              From citizen capture to verified ground cleanup — every step is tracked with spatial precision.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <div className="rounded-card border border-line bg-surface-2 p-5 shadow-sm">
              <div className="grid h-10 w-10 place-items-center rounded-field bg-accent-soft text-accent">
                <Icon name="camera" size={20} />
              </div>
              <h3 className="mt-4 font-semibold text-ink">1. Citizen Detection & Geotag</h3>
              <p className="mt-1.5 text-xs text-muted leading-relaxed">
                Residents snap photos of discarded plastics. Computer vision detects items and pins the exact location with civic GPS.
              </p>
            </div>

            <div className="rounded-card border border-line bg-surface-2 p-5 shadow-sm">
              <div className="grid h-10 w-10 place-items-center rounded-field bg-accent-soft text-accent">
                <Icon name="map" size={20} />
              </div>
              <h3 className="mt-4 font-semibold text-ink">2. AI-GIS Drainage Triage</h3>
              <p className="mt-1.5 text-xs text-muted leading-relaxed">
                Reports automatically cluster into hotspots. An Impact Algorithm ranks urgency based on drain proximity and flooding risk.
              </p>
            </div>

            <div className="rounded-card border border-line bg-surface-2 p-5 shadow-sm">
              <div className="grid h-10 w-10 place-items-center rounded-field bg-accent-soft text-accent">
                <Icon name="truck" size={20} />
              </div>
              <h3 className="mt-4 font-semibold text-ink">3. Verified Cleanup & Proof</h3>
              <p className="mt-1.5 text-xs text-muted leading-relaxed">
                Municipal officers dispatch field units. Citizens verify resolution through interactive before-and-after photo evidence.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- Footer ---- */}
      <footer className="border-t border-line bg-surface-2 py-6 text-center text-xs text-muted">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <p>
            UN Sustainable Development Goals 11 · 12 · 14 · TACO Object Detection Model · PlasticWatch Platform
          </p>
        </div>
      </footer>

      {/* ---------------------------------------------------------- About Modal ---- */}
      {aboutOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[1200] grid place-items-center bg-black/60 p-4 backdrop-blur-sm animate-rise"
          onClick={() => setAboutOpen(false)}
        >
          <div
            className="relative w-full max-w-lg rounded-card border border-line bg-surface p-6 shadow-pop text-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2.5">
                <Logo />
              </div>
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                aria-label="Close about dialog"
                className="grid h-8 w-8 place-items-center rounded-field text-muted hover:bg-surface-2 hover:text-ink transition-colors cursor-pointer"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs leading-relaxed text-muted">
              <div>
                <h4 className="font-semibold text-sm text-ink mb-1">Our Mission</h4>
                <p>
                  PlasticWatch is an AI-GIS spatial intelligence system designed to help cities,
                  municipalities, and communities detect, prioritize, and eliminate plastic waste accumulation
                  before it clogs drainage networks and pollutes urban waterways.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-sm text-ink mb-1">Human-in-the-Loop Architecture</h4>
                <p>
                  Computer vision identifies likely plastic types (bottles, bags, film, cups), but the AI never
                  has the final word. Field dispatches, verification, and resolution always require confirmation
                  by an authorized municipal officer.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-sm text-ink mb-1">Non-Attribution Guarantee</h4>
                <p>
                  PlasticWatch strictly tracks where waste is located to coordinate cleanup logistics.
                  It never attributes blame to individuals, protecting civic privacy and preventing vigilantism.
                </p>
              </div>

              <div className="rounded-field border border-accent/30 bg-accent-soft p-3 text-ink">
                <span className="block font-semibold mb-0.5 text-accent">Aligned with UN SDGs</span>
                <span>SDG 11 (Sustainable Cities), SDG 12 (Responsible Consumption), and SDG 14 (Life Below Water).</span>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="rounded-field bg-surface-2 border border-line px-4 py-2 text-xs font-semibold text-ink hover:bg-surface transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
