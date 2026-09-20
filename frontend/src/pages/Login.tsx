import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import type { DemoUser, UserRole } from "../api/client";
import { useApi } from "../api/hooks";
import { Icon, type IconName } from "../components/Icon";
import { Logo, ThemeToggle } from "../components/Shell";
import { ErrorState, Skeleton, cx } from "../components/ui";
import { NON_ATTRIBUTION_NOTE } from "../lib/status";
import { homeFor, loginAs, useSession } from "../store/auth";

const ROLES: { role: UserRole; title: string; blurb: string; icon: IconName }[] = [
  {
    role: "citizen",
    title: "Locals",
    blurb: "Photograph waste, pin where it is, and follow what happens next.",
    icon: "camera",
  },
  {
    role: "authority",
    title: "Government",
    blurb: "Ranked hotspots on the map, verify evidence, approve cleanups.",
    icon: "shield",
  },
];

const PRINCIPLES: { icon: IconName; text: string }[] = [
  { icon: "sparkle", text: "The AI flags likely plastic — it never has the last word." },
  { icon: "shield", text: "Nothing is verified or resolved until a person confirms it." },
  { icon: "users", text: "Reports show waste is present, never who is responsible." },
];

/** Reference-style "service" cards: the three stages of the pipeline. */
const STAGES: { icon: IconName; title: string; blurb: string }[] = [
  {
    icon: "camera",
    title: "Citizens report",
    blurb: "A photo and a pin. The detector flags likely plastic with a Low/Medium/High tier.",
  },
  {
    icon: "layers",
    title: "Merge & rank",
    blurb: "Duplicate reports fuse into one hotspot, ranked by impact near drains and water.",
  },
  {
    icon: "shield",
    title: "People decide",
    blurb: "Authorities verify evidence and approve cleanups. Nothing auto-resolves.",
  },
];

/** Stat band — every figure here is a truthful design fact, not a fabricated metric. */
const STATS: { value: string; label: string }[] = [
  { value: "3", label: "SDGs advanced (11 · 12 · 14)" },
  { value: "100%", label: "Human-verified before resolve" },
  { value: "0", label: "Hotspots auto-closed, ever" },
  { value: "TACO", label: "Open dataset behind detection" },
];

export default function Login() {
  const session = useSession();
  const navigate = useNavigate();
  const users = useApi<DemoUser[]>("/auth/demo-users");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to={homeFor(session.user.role)} replace />;

  const signIn = async (u: DemoUser) => {
    setBusy(u.id);
    setError(null);
    try {
      await loginAs({ user_id: u.id });
      navigate(homeFor(u.role), { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="min-h-full">
      {/* -------------------------------------------------------------- header -- */}
      <header className="sticky top-0 z-[1000] border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-6">
          <Logo />
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-[11px] font-semibold text-muted sm:flex">
              <Icon name="droplet" size={12} className="text-accent" />
              SDG 11 · 12 · 14
            </span>
            <a
              href="#signin"
              className="hidden min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover sm:flex"
            >
              Get started
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------------- hero -- */}
      <section className="relative overflow-hidden">
        {/* Subtle green wash — one confident accent, neutral canvas (CLAUDE.md §9). */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-40 h-[520px] w-[520px] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--pw-accent-soft), transparent 70%)" }}
        />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-5 py-10 md:grid-cols-[1.05fr_1fr] md:items-center md:gap-14 md:py-16">
          <div className="animate-rise">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
              <Icon name="sparkle" size={13} />
              AI-GIS for plastic-waste hotspots
            </span>
            <h1 className="font-display mt-6 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Find plastic hotspots.
              <br />
              <span className="text-accent">Clean the worst first.</span>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted">
              Citizens report likely plastic waste with a photo. Duplicates merge into hotspots,
              ranked by impact near drains and water — then people, not the model, decide what
              happens.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="#signin"
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.98]"
              >
                Choose a demo role
                <Icon name="arrowRight" size={16} />
              </a>
              <a
                href="#how"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-5 text-sm font-semibold text-ink transition-colors hover:border-line-strong"
              >
                How it works
              </a>
            </div>
            <ul className="mt-8 space-y-3">
              {PRINCIPLES.map((p) => (
                <li key={p.text} className="flex items-start gap-3 text-sm">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                    <Icon name={p.icon} size={16} />
                  </span>
                  <span className="pt-1.5">{p.text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* ------------------------------------------------ sign-in (role) card -- */}
          <div id="signin" className="animate-rise scroll-mt-20 [animation-delay:80ms]">
            <div className="rounded-[20px] border border-line bg-surface p-5 shadow-raised sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Choose a demo role</h2>
                  <p className="mt-1 text-sm text-muted">
                    Seeded demo accounts — no passwords. This is not real authentication.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {users.error ? (
                  <ErrorState message={users.error.message} onRetry={users.refetch} />
                ) : !users.data ? (
                  [0, 1].map((i) => <Skeleton key={i} className="h-[76px] w-full rounded-xl" />)
                ) : (
                  ROLES.map((r) => {
                    const u = users.data!.find((x) => x.role === r.role);
                    if (!u) return null;
                    return (
                      <button
                        key={r.role}
                        onClick={() => signIn(u)}
                        disabled={busy !== null}
                        className={cx(
                          "group flex w-full items-center gap-4 rounded-xl border border-line bg-surface p-4 text-left",
                          "transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-accent hover:shadow-raised",
                          "disabled:opacity-60",
                        )}
                      >
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink transition-colors group-hover:bg-accent group-hover:text-accent-fg">
                          <Icon name={r.icon} size={20} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 font-semibold">
                            {r.title}
                            <span className="truncate text-xs font-normal text-faint">{u.name}</span>
                          </span>
                          <span className="mt-0.5 block text-sm text-muted">{r.blurb}</span>
                        </span>
                        {busy === u.id ? (
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-r-transparent" />
                        ) : (
                          <Icon
                            name="arrowRight"
                            size={18}
                            className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                          />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
            </div>
            <p className="mt-4 text-center text-xs text-faint">
              SDGs 11 · 12 · 14 — detection model trained on TACO. Demo geotags are simulated.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- service cards -- */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-5 pb-2 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {STAGES.map((s, i) => (
            <div
              key={s.title}
              className="animate-rise rounded-2xl border border-line bg-surface p-5 shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-raised"
              style={{ animationDelay: `${120 + i * 60}ms` }}
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
                <Icon name={s.icon} size={20} />
              </span>
              <h3 className="mt-4 flex items-center gap-2 font-semibold">
                <span className="text-xs font-bold text-faint">0{i + 1}</span>
                {s.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- stat band -- */}
      <section className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
        <div
          className="grid grid-cols-2 gap-6 rounded-[24px] px-6 py-8 sm:grid-cols-4 sm:px-10"
          style={{
            background: "linear-gradient(120deg, #14532d 0%, #166534 55%, #15803d 100%)",
          }}
        >
          {STATS.map((s) => (
            <div key={s.label} className="text-center text-white">
              <div className="tabular font-display text-3xl font-bold sm:text-4xl">{s.value}</div>
              <div className="mx-auto mt-1.5 max-w-[16ch] text-xs leading-snug text-emerald-100/90">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------- footer -- */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="info" size={13} className="shrink-0 text-accent" />
            {NON_ATTRIBUTION_NOTE}
          </span>
          <span className="text-faint">
            &ldquo;Likely plastic&rdquo; is derived from a category map, not a ground-truth label.
          </span>
        </div>
      </footer>
    </div>
  );
}
