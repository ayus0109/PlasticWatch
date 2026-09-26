import { useNavigate } from "react-router";
import type { PublicSummary } from "../api/client";
import { useApi } from "../api/hooks";
import { HamburgerMenu } from "../components/HamburgerMenu";
import { Icon } from "../components/Icon";
import { Logo } from "../components/Shell";
import { useSession, homeFor } from "../store/auth";

const HERO_TILES: { key: keyof PublicSummary; label: string; hint: string }[] = [
  { key: "active_hotspots", label: "Active hotspots", hint: "open and tracked" },
  { key: "awaiting_verification", label: "Awaiting review", hint: "queued for a person" },
  { key: "total_reports", label: "Citizen reports", hint: "photos submitted" },
  { key: "resolved_hotspots", label: "Resolved", hint: "closed by an authority" },
];

const FEATURES = [
  {
    icon: "camera" as const,
    title: "1. Citizen Photo Capture",
    description:
      "Locals snap photos of waste in urban streets, drains, or canals. Automated EXIF metadata captures precise location and time.",
  },
  {
    icon: "detect" as const,
    title: "2. Dual-Engine AI Detection",
    description:
      "Neural network models identify bottles, bags, and packaging, while contour saliency catches fragmented and crushed debris.",
  },
  {
    icon: "map" as const,
    title: "3. Spatial GIS Hotspot Fusion",
    description:
      "PostGIS clustering merges duplicate proximate reports into living hotspots, ranked by distance to storm drains and waterways.",
  },
  {
    icon: "shield" as const,
    title: "4. Human Authority Gate",
    description:
      "The AI model assists prioritization, but never has the last word. Municipal officers verify evidence before dispatch.",
  },
];

export default function Landing() {
  const session = useSession();
  const navigate = useNavigate();
  const stats = useApi<PublicSummary>("/analytics/public");

  const goToLogin = (role?: "citizen" | "authority") => {
    if (session) {
      navigate(homeFor(session.user.role));
      return;
    }
    if (role) {
      navigate(`/login?role=${role}`);
    } else {
      navigate("/login");
    }
  };

  return (
    <div className="relative min-h-full bg-bg text-ink flex flex-col">
      {/* ----------------------------------------------------------------- HERO ---- */}
      <section className="relative isolate overflow-hidden text-white">
        {/* Underlay tone */}
        <div aria-hidden className="absolute inset-0 -z-30 bg-[#042019]" />
        
        {/* Background waterway photograph */}
        <div
          aria-hidden
          className="absolute inset-0 -z-20 bg-cover bg-center bg-no-repeat transition-all duration-700"
          style={{ backgroundImage: "url('/hero-waterway.jpg')" }}
        />
        
        {/* Scrim gradient: darker on left for clear readability, lighter on right for skyline */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(108deg, rgba(4, 38, 28, 0.90) 0%, rgba(4, 38, 28, 0.74) 45%, rgba(6, 60, 48, 0.40) 80%, rgba(15, 23, 42, 0.50) 100%)",
          }}
        />

        <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 md:py-12">
          {/* Top Bar with Logo & Hamburger Corner Menu */}
          <div className="flex items-center justify-between gap-4">
            <Logo onDark size="lg" />
            <HamburgerMenu onDark showSignInButton={!session} />
          </div>

          {/* Hero Content */}
          <div className="animate-rise mt-8 sm:mt-12">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              AI & GIS Waterway Waste Intelligence Platform
            </span>

            <h1 className="font-display mt-5 max-w-4xl text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl md:text-5xl drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
              AI and GIS for urban waterway and waste intelligence
            </h1>

            <p className="mt-5 max-w-2xl text-body leading-relaxed text-white/90 drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
              Citizens photograph likely plastic waste. Duplicate reports merge into hotspots,
              ranked by impact near drains and water — then a person, not the model, decides
              what happens next.
            </p>

            {/* Authenticated quick jump button */}
            {session && (
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => navigate(homeFor(session.user.role))}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-field bg-accent px-6 text-label font-bold text-accent-fg transition-transform duration-150 hover:-translate-y-px active:translate-y-0 active:scale-[0.98] shadow-lg"
                >
                  <Icon name="shield" size={17} />
                  Open {session.user.role === "authority" ? "Government Dashboard" : "Citizen Portal"}
                </button>
              </div>
            )}
          </div>

          {/* Live Civic Counts */}
          <div className="mt-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {HERO_TILES.map((t) => {
              const value = stats.data ? (stats.data[t.key] as number) : null;
              return (
                <div
                  key={t.key}
                  className="rounded-card border border-white/20 bg-black/25 p-4 backdrop-blur-md shadow-md"
                >
                  <div className="text-micro font-semibold text-white/70">{t.label}</div>
                  <div className="font-display tabular mt-1.5 text-display font-bold text-white">
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

          {stats.error ? (
            <div className="mt-4 flex min-h-7 flex-wrap items-center gap-2 text-micro text-white/70">
              <span>Live totals are syncing. Real-time metrics will update automatically.</span>
            </div>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------------------- HOW IT WORKS ---- */}
      <section className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8 md:py-16">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-xs font-bold uppercase tracking-wider text-accent">
            End-to-End Civic Pipeline
          </span>
          <h2 className="font-display mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-ink">
            How PlasticWatch Works
          </h2>
          <p className="mt-3 text-sm text-muted">
            From a single mobile photograph to synchronized municipal cleanup routes.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-card border border-line bg-surface p-5 shadow-sm hover:border-line-strong transition-colors"
            >
              <div className="grid h-10 w-10 place-items-center rounded-field bg-surface-2 text-accent mb-4">
                <Icon name={f.icon} size={20} />
              </div>
              <h3 className="font-display text-sm font-bold text-ink">{f.title}</h3>
              <p className="mt-2 text-xs text-muted leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>

        {/* Core Ethical Guarantee Banner */}
        <div className="mt-8 rounded-card border border-accent/30 bg-accent-soft p-5 text-ink flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
            <Icon name="shield" size={20} />
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-sm text-ink">Strict Non-Attribution Architecture</h4>
            <p className="mt-1 text-xs text-muted leading-relaxed">
              Reports verify where plastic litter is present — <strong>never who discarded it</strong>.
              No citizen is surveilled or penalized. Machine learning accelerates spatial triage, but
              every enforcement and cleanup task requires human verification.
            </p>
          </div>
          <button
            type="button"
            onClick={() => goToLogin()}
            className="shrink-0 rounded-field bg-surface border border-line px-4 py-2 text-xs font-bold text-ink hover:border-accent hover:text-accent transition-colors shadow-sm"
          >
            Access System
          </button>
        </div>
      </section>

      {/* ----------------------------------------------------------- FOOTER ---- */}
      <footer className="mt-auto border-t border-line bg-surface py-8 text-center text-xs text-muted">
        <div className="mx-auto max-w-6xl px-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Logo compact size="sm" />
            <span>· Eco-GIS Environmental Intelligence</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-micro">
            <span>SDGs 11 · 12 · 14</span>
            <span>·</span>
            <span>Geo data © OpenStreetMap</span>
            <span>·</span>
            <button
              type="button"
              onClick={() => goToLogin()}
              className="font-semibold text-accent hover:underline"
            >
              Sign In to Portal »
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
