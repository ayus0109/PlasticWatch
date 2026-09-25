import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import type { DemoUser, UserRole } from "../api/client";
import { useApi } from "../api/hooks";
import { Icon, type IconName } from "../components/Icon";
import { Logo, ThemeToggle } from "../components/Shell";
import { Button, cx, Spinner } from "../components/ui";
import { EarthGlobe } from "../components/EarthGlobe";
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

type AuthTab = "login" | "register" | "demo";

export default function Login() {
  const session = useSession();
  const navigate = useNavigate();
  const users = useApi<DemoUser[]>("/auth/demo-users");

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

  const fillDemoCredentials = (role: UserRole) => {
    setTab("login");
    setLoginEmail(role === "citizen" ? "citizen@plasticwatch.local" : "authority@plasticwatch.local");
    setLoginPassword("password123");
    setError(null);
  };

  return (
    <div className="relative min-h-full overflow-hidden">
      {/* Ambient cosmic glows inspired by Spline 3D Earth */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/5 blur-[120px] dark:bg-cyan-500/10" />
      <div className="pointer-events-none absolute top-1/2 -right-40 h-96 w-96 rounded-full bg-blue-600/5 blur-[140px] dark:bg-blue-600/10" />

      <div className="mx-auto grid min-h-full max-w-6xl gap-10 px-5 py-8 md:grid-cols-[1.05fr_1fr] md:items-center md:gap-16 md:py-16">
        {/* Left Branding Column */}
        <div className="animate-rise">
          <div className="flex items-center justify-between">
            <Logo />
            <div className="md:hidden">
              <ThemeToggle />
            </div>
          </div>
          <h1 className="font-display mt-8 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            Find plastic hotspots.
            <br />
            <span className="text-accent">Clean the worst first.</span>
          </h1>
          <p className="mt-4 max-w-md text-body leading-relaxed text-muted">
            Citizens report likely plastic waste with a photo. Duplicates merge into hotspots,
            ranked by impact near drains and water — then people, not the model, decide what
            happens.
          </p>

          {/* Interactive 3D Earth Orbit Card inspired by Spline */}
          <div className="mt-6 overflow-hidden rounded-card border border-line bg-gradient-to-b from-[#070e1b] via-[#050a14] to-[#020408] p-4 text-white shadow-raised">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
                <span className="text-xs font-semibold tracking-wider uppercase text-cyan-300">
                  Global Earth Sentinel · Day & Night
                </span>
              </div>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-mono text-cyan-200">
                Orbital GIS
              </span>
            </div>

            <div className="relative my-2 h-56 sm:h-64 w-full">
              <EarthGlobe className="h-full w-full" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2.5 text-[11px] text-white/70">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400"></span>
                <span>Day Biosphere</span>
                <span className="text-white/30">•</span>
                <span className="inline-block h-2 w-2 rounded-full bg-amber-400"></span>
                <span>Night City Lights</span>
                <span className="text-white/30">•</span>
                <span className="inline-block h-2 w-2 rounded-full bg-rose-500"></span>
                <span>Drainage Hotspots</span>
              </div>
              <span className="text-[10px] text-cyan-300/80">✦ Drag to rotate globe</span>
            </div>
          </div>

          <ul className="mt-6 space-y-2.5">
            {PRINCIPLES.map((p) => (
              <li key={p.text} className="flex items-start gap-3 text-sm">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-accent-soft text-accent">
                  <Icon name={p.icon} size={16} />
                </span>
                <span className="pt-1.5">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Right Authentication Card */}
        <div className="animate-rise [animation-delay:80ms]">
          <div className="rounded-card border border-line bg-surface p-6 shadow-raised sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-ink">Welcome to PlasticWatch</h2>
                <p className="mt-1 text-sm text-muted">
                  Sign in to your account, create a new one, or try quick demo roles.
                </p>
              </div>
              <div className="hidden md:block">
                <ThemeToggle />
              </div>
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
                  "flex-1 rounded-field py-1.5 text-center transition-all",
                  tab === "login"
                    ? "bg-surface font-semibold text-ink shadow-sm"
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
                  "flex-1 rounded-field py-1.5 text-center transition-all",
                  tab === "register"
                    ? "bg-surface font-semibold text-ink shadow-sm"
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
                  "flex-1 rounded-field py-1.5 text-center transition-all",
                  tab === "demo"
                    ? "bg-surface font-semibold text-ink shadow-sm"
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
                      className="rounded border border-line bg-surface px-2 py-1 font-medium hover:border-accent hover:text-accent transition-colors"
                    >
                      Fill Citizen Credentials
                    </button>
                    <button
                      type="button"
                      onClick={() => fillDemoCredentials("authority")}
                      className="rounded border border-line bg-surface px-2 py-1 font-medium hover:border-accent hover:text-accent transition-colors"
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
          <p className="mt-4 text-center text-xs text-faint">
            SDGs 11 · 12 · 14 — detection model trained on TACO. Demo geotags are simulated.
          </p>
        </div>
      </div>
    </div>
  );
}
