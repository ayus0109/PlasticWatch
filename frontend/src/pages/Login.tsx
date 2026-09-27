import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import type { DemoUser, UserRole } from "../api/client";
import { useApi } from "../api/hooks";
import { Icon, type IconName } from "../components/Icon";
import { Logo, ThemeToggle } from "../components/Shell";
import { Button, cx, Spinner } from "../components/ui";
import {
  homeFor,
  loginAs,
  loginWithPassword,
  registerUser,
  setSessionToken,
  useSession,
} from "../store/auth";
import { formatUserName } from "../lib/format";

const FALLBACK_USERS: Record<UserRole, DemoUser> = {
  citizen: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Aarav Sharma (Citizen)",
    email: "citizen@plasticwatch.local",
    role: "citizen",
    ward_id: 1,
    reliability: 0.5,
    is_simulated: true,
  },
  authority: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Municipal Sanitation Officer",
    email: "authority@plasticwatch.local",
    role: "authority",
    ward_id: null,
    reliability: 0.5,
    is_simulated: true,
  },
  team: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Field Operations Unit 1",
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

type AuthTab = "login" | "register" | "demo";

export default function Login() {
  const session = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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

  const fillDemoCredentials = (role: UserRole) => {
    setTab("login");
    setLoginEmail(role === "citizen" ? "citizen@plasticwatch.local" : "authority@plasticwatch.local");
    setLoginPassword("password123");
    setError(null);
  };

  useEffect(() => {
    const roleParam = searchParams.get("role") as UserRole | null;
    const tabParam = searchParams.get("tab") as AuthTab | null;
    if (tabParam && ["login", "register", "demo"].includes(tabParam)) {
      setTab(tabParam);
    }
    if (roleParam === "citizen" || roleParam === "authority") {
      fillDemoCredentials(roleParam);
    }
  }, [searchParams]);

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

  return (
    <div className="relative min-h-full flex flex-col justify-between">
      {/* Background eco-india image */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none -z-10 overflow-hidden"
      >
        <img
          src="/eco-india-bg.jpg"
          alt=""
          className="h-full w-full object-cover object-bottom sm:object-center opacity-90 transition-opacity"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-surface/85 via-surface/65 to-surface/85 backdrop-blur-[0.5px]" />
      </div>

      {/* Header bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="PlasticWatch home" className="flex items-center">
            <Logo />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-field px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink transition-colors"
            >
              <Icon name="chevronLeft" size={14} />
              Back to Home
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Login Card */}
      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-md animate-rise">
          <div className="rounded-panel border border-line bg-surface p-6 shadow-raised sm:p-7">
            <div>
              <h1 className="font-display text-heading font-bold tracking-tight text-ink">
                Sign in to PlasticWatch
              </h1>
              <p className="mt-1 text-label text-muted">
                Access your citizen reporting dashboard or municipal command portal.
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
                  "flex-1 rounded-field py-2.5 min-h-[42px] text-center transition-all cursor-pointer",
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
                  "flex-1 rounded-field py-2.5 min-h-[42px] text-center transition-all cursor-pointer",
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
                  "flex-1 rounded-field py-2.5 min-h-[42px] text-center transition-all cursor-pointer",
                  tab === "demo"
                    ? "bg-surface font-semibold text-ink shadow-card"
                    : "text-muted hover:text-ink",
                )}
              >
                Role Profiles
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

                {/* Quick Fill helper */}
                <div className="mt-4 rounded-field border border-line/60 bg-surface-2 p-3 text-xs text-muted">
                  <div className="font-semibold text-ink">Presentation & Evaluation Access:</div>
                  <div className="mt-1 flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => fillDemoCredentials("citizen")}
                      className="rounded border border-line bg-surface px-3 py-1.5 min-h-[36px] font-medium hover:border-accent hover:text-accent transition-colors active:scale-95 cursor-pointer"
                    >
                      Fill Citizen Credentials
                    </button>
                    <button
                      type="button"
                      onClick={() => fillDemoCredentials("authority")}
                      className="rounded border border-line bg-surface px-3 py-1.5 min-h-[36px] font-medium hover:border-accent hover:text-accent transition-colors active:scale-95 cursor-pointer"
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
                        "flex items-center gap-2.5 rounded-field border p-2.5 text-left text-xs transition-colors cursor-pointer",
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
                        "flex items-center gap-2.5 rounded-field border p-2.5 text-left text-xs transition-colors cursor-pointer",
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

            {/* Tab 3: Quick Role Profiles */}
            {tab === "demo" && (
              <div className="mt-5 space-y-3">
                <p className="text-xs text-muted">
                  Instant access profiles for evaluation and live demonstration:
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
                        "group flex w-full items-center gap-4 rounded-card border border-line bg-surface p-3.5 text-left cursor-pointer",
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
                          <span className="truncate text-xs font-normal text-faint">{formatUserName(u.name)}</span>
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
            UN Sustainable Development Goals 11 · 12 · 14 · AI-GIS Municipal Sanitation Platform
          </p>
        </div>
      </main>

      <div className="h-6" />
    </div>
  );
}
