import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import type { DemoUser, PublicSummary, UserRole } from "../api/client";
import { useApi } from "../api/hooks";
import { Icon, type IconName } from "../components/Icon";
import { Logo, ThemeToggle } from "../components/Shell";
import { Button, cx, SimulatedBadge, Spinner } from "../components/ui";
import {
  homeFor,
  loginAs,
  loginWithPassword,
  registerUser,
  setSessionToken,
  useSession,
} from "../store/auth";

const FALLBACK_USERS: Record<UserRole, DemoUser> = {
  citizen: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Demo Citizen A",
    email: "citizen@plasticwatch.local",
    role: "citizen",
    ward_id: 1,
    reliability: 0.5,
    is_simulated: true,
  },
  authority: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Demo Ward Authority",
    email: "authority@plasticwatch.local",
    role: "authority",
    ward_id: null,
    reliability: 0.5,
    is_simulated: true,
  },
  team: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Demo Cleanup Team 1",
    email: "team@plasticwatch.local",
    role: "team",
    ward_id: null,
    reliability: 0.5,
    is_simulated: true,
  },
};

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

/** Live civic totals. Only counts the public endpoint actually returns — no
 *  accuracy or tonnage claims, because nothing here can measure those. */
const HERO_TILES: { key: keyof PublicSummary; label: string; hint: string }[] = [
  { key: "active_hotspots", label: "Active hotspots", hint: "open and tracked" },
  { key: "awaiting_verification", label: "Awaiting review", hint: "queued for a person" },
  { key: "total_reports", label: "Citizen reports", hint: "photos submitted" },
  { key: "resolved_hotspots", label: "Resolved", hint: "closed by an authority" },
];

type AuthTab = "login" | "register" | "demo";

export default function Login() {
  const session = useSession();
  const navigate = useNavigate();
  const users = useApi<DemoUser[]>("/auth/demo-users");
  const stats = useApi<PublicSummary>("/analytics/public");

  const [tab, setTab] = useState<AuthTab>("login");
  const [busy, setBusy] = useState<boolean>(false);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register form state
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regRole, setRegRole] = useState<UserRole>("citizen");

  if (session) return <Navigate to={homeFor(session.user.role)} replace />;

  const handleDemoSignIn = async (u: DemoUser) => {
    setDemoBusy(u.id);
    setError(null);
    try {
      await loginAs({ user_id: u.id, role: u.role });
      navigate(homeFor(u.role), { replace: true });
    } catch {
      // Offline fallback: if network fails or server is cold-starting,
      // create a local demo session so the user is never locked out.
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      setSessionToken("offline-demo-token", u, expiresAt);
      navigate(homeFor(u.role), { replace: true });
    } finally {
      setDemoBusy(null);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      setError("Please provide your email/username and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await loginWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });
      navigate(homeFor(res.user.role), { replace: true });
    } catch (err) {
      setError((err as Error).message || "Failed to sign in. Check your credentials.");
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!regEmail.trim() || !regEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (regPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await registerUser({
        name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
        role: regRole,
      });
      navigate(homeFor(res.user.role), { replace: true });
    } catch (err) {
      setError((err as Error).message || "Registration failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  /** Hero CTAs do not sign anyone in: they carry you to the access panel with the
   *  matching demo credentials filled, so the click does exactly what it says. */
  const goToAccess = (role: UserRole) => {
    fillDemoCredentials(role);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById("access")
      ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  const fillDemoCredentials = (role: UserRole) => {
    setTab("login");
    setLoginEmail(role === "citizen" ? "citizen@plasticwatch.local" : "authority@plasticwatch.local");
    setLoginPassword("password123");
    setError(null);
  };

  return (
    <div className="relative min-h-full">
      {/* ----------------------------------------------------------------- hero ---- */}
      <section className="relative isolate overflow-hidden text-white">
        {/* Underlay tone */}
        <div
          aria-hidden
          className="absolute inset-0 -z-30 bg-[#042019]"
        />
        {/* Background waterway photograph */}
        <div
          aria-hidden
          className="absolute inset-0 -z-20 bg-cover bg-center bg-no-repeat transition-all duration-700"
          style={{ backgroundImage: "url('/hero-waterway.jpg')" }}
        />
        {/* Semi-transparent scrim: deeper on the left for text readability,
            gentler on the right so the waterway, park, and city skyline remain clearly visible */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(108deg, rgba(4, 38, 28, 0.88) 0%, rgba(4, 38, 28, 0.72) 42%, rgba(6, 60, 48, 0.38) 78%, rgba(15, 23, 42, 0.48) 100%)",
          }}
        />
        {/* Vertical vignette to anchor bottom cards */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(180deg, rgba(0, 0, 0, 0.20) 0%, transparent 40%, rgba(4, 25, 20, 0.55) 100%)",
          }}
        />

        <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 md:py-16">
          <div className="flex items-center justify-between gap-4">
            <Logo onDark />
            <ThemeToggle onDark />
          </div>

          <div className="animate-rise">
            <span className="mt-10 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-micro font-semibold backdrop-blur-sm shadow-sm">
              <Icon name="sparkle" size={13} />
              AI-assisted spatial triage
            </span>

            <h1 className="font-display mt-5 max-w-4xl text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl md:text-5xl drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
              AI and GIS for urban waterway and waste intelligence
            </h1>

            <p className="mt-5 max-w-2xl text-body leading-relaxed text-white/90 drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
              Citizens photograph likely plastic waste. Duplicate reports merge into hotspots,
              ranked by impact near drains and water — then a person, not the model, decides
              what happens next.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => goToAccess("citizen")}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-field bg-accent px-5 text-label font-semibold text-accent-fg transition-transform duration-150 hover:-translate-y-px active:translate-y-0 active:scale-[0.98]"
              >
                <Icon name="camera" size={17} />
                Sign in to report waste
              </button>
              <button
                type="button"
                onClick={() => goToAccess("authority")}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-field border border-white/30 bg-white/10 px-5 text-label font-semibold text-white backdrop-blur-sm transition-[transform,background-color] duration-150 hover:-translate-y-px hover:bg-white/20 active:translate-y-0 active:scale-[0.98]"
              >
                <Icon name="shield" size={17} />
                Sign in as authority
              </button>
            </div>

            <ul className="mt-8 flex flex-col gap-2 text-label text-white/80 sm:flex-row sm:flex-wrap sm:gap-x-6">
              {PRINCIPLES.map((pr) => (
                <li key={pr.text} className="flex items-start gap-2">
                  <Icon name={pr.icon} size={15} className="mt-0.5 shrink-0 text-accent" />
                  <span>{pr.text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Live counts from /analytics/public — totals only, no session required. */}
          <div className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {HERO_TILES.map((t) => {
              const value = stats.data ? (stats.data[t.key] as number) : null;
              return (
                <div
                  key={t.key}
                  className="rounded-card border border-white/20 bg-black/25 p-4 backdrop-blur-md shadow-md"
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

          <div className="mt-4 flex min-h-7 flex-wrap items-center gap-2 text-micro text-white/70">
            {stats.error ? (
              <span>Live totals are unavailable right now. The figures above will fill in once the service responds.</span>
            ) : stats.data?.simulated_data ? (
              <>
                <SimulatedBadge />
                <span>These counts come from seeded demo data.</span>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- access ---- */}
      <section id="access" className="bg-bg">
        <div className="mx-auto w-full max-w-lg px-5 py-12 sm:px-8 md:py-16">
          <div className="rounded-panel border border-line bg-surface p-6 shadow-raised sm:p-7">
            <div>
              <h2 className="font-display text-heading font-bold tracking-tight text-ink">
                Sign in to PlasticWatch
              </h2>
              <p className="mt-1 text-label text-muted">
                Use your account, create one, or pick a demo role.
              </p>
            </div>

            {/* Auth Navigation Tabs */}
            <div className="mt-6 flex rounded-field bg-surface-2 p-1 text-sm font-medium">
              <button
                type="button"
                onClick={() => {
                  setTab("login");
                  setError(null);
                }}
                className={cx(
                  "flex-1 rounded-field py-2.5 min-h-[42px] text-center transition-all",
                  tab === "login"
                    ? "bg-surface font-semibold text-ink shadow-card"
                    : "text-muted hover:text-ink",
                )}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("register");
                  setError(null);
                }}
                className={cx(
                  "flex-1 rounded-field py-2.5 min-h-[42px] text-center transition-all",
                  tab === "register"
                    ? "bg-surface font-semibold text-ink shadow-card"
                    : "text-muted hover:text-ink",
                )}
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("demo");
                  setError(null);
                }}
                className={cx(
                  "flex-1 rounded-field py-2.5 min-h-[42px] text-center transition-all",
                  tab === "demo"
                    ? "bg-surface font-semibold text-ink shadow-card"
                    : "text-muted hover:text-ink",
                )}
              >
                Quick Demo
              </button>
            </div>

            {/* Error Message Strip */}
            {error && (
              <div className="mt-4 flex items-start gap-2.5 rounded-field border border-danger/30 bg-danger/10 p-3 text-sm text-danger animate-rise">
                <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
                <span className="flex-1">{error}</span>
              </div>
            )}

            {/* Tab 1: Email + Password Login */}
            {tab === "login" && (
              <form onSubmit={handlePasswordLogin} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-ink" htmlFor="login-email">
                    Email or Username
                  </label>
                  <input
                    id="login-email"
                    type="text"
                    autoComplete="username"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="name@example.com or citizen"
                    className="mt-1 w-full rounded-field border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-ink" htmlFor="login-password">
                      Password
                    </label>
                  </div>
                  <input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1 w-full rounded-field border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  className="w-full"
                >
                  Sign In
                </Button>

                {/* Demo Quick Fill helper */}
                <div className="mt-4 rounded-field border border-line/60 bg-surface-2 p-3 text-xs text-muted">
                  <div className="font-semibold text-ink">Testing or evaluating?</div>
                  <div className="mt-1 flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => fillDemoCredentials("citizen")}
                      className="rounded border border-line bg-surface px-3 py-1.5 min-h-[36px] font-medium hover:border-accent hover:text-accent transition-colors active:scale-95"
                    >
                      Fill Citizen Credentials
                    </button>
                    <button
                      type="button"
                      onClick={() => fillDemoCredentials("authority")}
                      className="rounded border border-line bg-surface px-3 py-1.5 min-h-[36px] font-medium hover:border-accent hover:text-accent transition-colors active:scale-95"
                    >
                      Fill Authority Credentials
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Tab 2: User Registration */}
            {tab === "register" && (
              <form onSubmit={handleRegister} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-ink" htmlFor="reg-name">
                    Full Name
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    autoComplete="name"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Jane Doe"
                    className="mt-1 w-full rounded-field border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-ink" htmlFor="reg-email">
                    Email Address
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    autoComplete="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="jane@example.org"
                    className="mt-1 w-full rounded-field border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-ink" htmlFor="reg-password">
                    Password (min 6 characters)
                  </label>
                  <input
                    id="reg-password"
                    type="password"
                    autoComplete="new-password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={6}
                    className="mt-1 w-full rounded-field border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-ink mb-1.5">
                    Account Role
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRegRole("citizen")}
                      className={cx(
                        "flex items-center gap-2.5 rounded-field border p-2.5 text-left text-xs transition-colors",
                        regRole === "citizen"
                          ? "border-accent bg-accent-soft text-accent font-semibold"
                          : "border-line bg-surface text-muted hover:border-line-strong",
                      )}
                    >
                      <Icon name="camera" size={16} />
                      <div>
                        <div>Local Citizen</div>
                        <div className="text-[10px] opacity-75">Report waste</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setRegRole("authority")}
                      className={cx(
                        "flex items-center gap-2.5 rounded-field border p-2.5 text-left text-xs transition-colors",
                        regRole === "authority"
                          ? "border-accent bg-accent-soft text-accent font-semibold"
                          : "border-line bg-surface text-muted hover:border-line-strong",
                      )}
                    >
                      <Icon name="shield" size={16} />
                      <div>
                        <div>Government</div>
                        <div className="text-[10px] opacity-75">Verify & plan</div>
                      </div>
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  className="w-full mt-2"
                >
                  Create Account
                </Button>
              </form>
            )}

            {/* Tab 3: Quick Demo Roles */}
            {tab === "demo" && (
              <div className="mt-5 space-y-3">
                <p className="text-xs text-muted">
                  One-click demo login without credentials for fast evaluation:
                </p>
                {ROLES.map((r) => {
                  const u = users.data?.find((x) => x.role === r.role) ?? FALLBACK_USERS[r.role];
                  const isBusy = demoBusy === u.id || demoBusy === r.role;
                  return (
                    <button
                      key={r.role}
                      type="button"
                      onClick={() => handleDemoSignIn(u)}
                      disabled={demoBusy !== null}
                      className={cx(
                        "group flex w-full items-center gap-4 rounded-card border border-line bg-surface p-3.5 text-left",
                        "transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-accent hover:shadow-raised",
                        "disabled:opacity-60",
                      )}
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-surface-2 text-ink transition-colors group-hover:bg-accent group-hover:text-accent-fg">
                        <Icon name={r.icon} size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 font-semibold text-sm">
                          {r.title}
                          <span className="truncate text-xs font-normal text-faint">{u.name}</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">{r.blurb}</span>
                      </span>
                      {isBusy ? (
                        <Spinner />
                      ) : (
                        <Icon
                          name="arrowRight"
                          size={18}
                          className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <p className="mt-5 text-center text-micro text-faint">
            SDGs 11 · 12 · 14 · detection model trained on TACO. Demo geotags are simulated.
          </p>
        </div>
      </section>
    </div>
  );
}
