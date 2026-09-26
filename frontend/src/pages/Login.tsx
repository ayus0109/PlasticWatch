import { useState, useEffect } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import type { DemoUser, UserRole } from "../api/client";
import { useApi } from "../api/hooks";
import { HamburgerMenu } from "../components/HamburgerMenu";
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

const FALLBACK_USERS: Record<UserRole, DemoUser> = {
  citizen: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Aarav Sharma",
    email: "citizen@plasticwatch.local",
    role: "citizen",
    ward_id: 1,
    reliability: 0.5,
    is_simulated: true,
  },
  authority: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Priya Verma (Officer)",
    email: "authority@plasticwatch.local",
    role: "authority",
    ward_id: null,
    reliability: 0.5,
    is_simulated: true,
  },
  team: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Rapid Cleanup Team 1",
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
  const [regCentreId, setRegCentreId] = useState("");
  const [regDepartment, setRegDepartment] = useState("");

  // Read URL query parameter: e.g. /login?role=citizen or /login?role=authority
  useEffect(() => {
    const roleParam = searchParams.get("role");
    if (roleParam === "citizen" || roleParam === "authority") {
      fillDemoCredentials(roleParam);
      setRegRole(roleParam);
    }
  }, [searchParams]);

  if (session) return <Navigate to={homeFor(session.user.role)} replace />;

  const fillDemoCredentials = (role: UserRole) => {
    setTab("login");
    setLoginEmail(
      role === "citizen" ? "citizen@plasticwatch.local" : "authority@plasticwatch.local",
    );
    setLoginPassword("password123");
    if (role === "authority") {
      setRegCentreId("PMC-CENTRE-401");
      setRegDepartment("Urban Solid Waste & Sanitation Bureau");
    }
    setError(null);
  };

  const handleDemoSignIn = async (u: DemoUser) => {
    setDemoBusy(u.id);
    setError(null);
    try {
      await loginAs({ user_id: u.id, role: u.role });
      navigate(homeFor(u.role), { replace: true });
    } catch {
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
    if (regRole === "authority" && !regCentreId.trim()) {
      setError("Municipal Centre ID or Ward ID is required for Government Official accounts (e.g. PMC-CENTRE-401).");
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
        centre_id: regRole === "authority" ? regCentreId.trim() : undefined,
        department: regRole === "authority" ? regDepartment.trim() : undefined,
      });
      navigate(homeFor(res.user.role), { replace: true });
    } catch (err) {
      setError((err as Error).message || "Registration failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-full bg-bg text-ink flex flex-col">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="Back to home" className="flex items-center gap-2">
            <Logo size="md" />
          </Link>

          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-field px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink transition-colors"
            >
              <Icon name="chevronLeft" size={14} />
              <span>Back to Overview</span>
            </Link>

            <ThemeToggle />
            <HamburgerMenu showSignInButton={false} />
          </div>
        </div>
      </header>

      {/* Main Authentication Card */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-10">
        <div className="w-full max-w-md animate-rise">
          <div className="rounded-panel border border-line bg-surface p-6 shadow-raised sm:p-8">
            <div className="text-center sm:text-left">
              <span className="inline-block rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-bold text-accent mb-2">
                Authentication Portal
              </span>
              <h1 className="font-display text-heading font-bold tracking-tight text-ink">
                Sign in to PlasticWatch
              </h1>
              <p className="mt-1 text-label text-muted">
                Access your citizen report history or government triage desk.
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
                Role Preview
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
                    Email Address or Centre ID
                  </label>
                  <input
                    id="login-email"
                    type="text"
                    autoComplete="username"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="user@example.org or PMC-CENTRE-401"
                    className="mt-1 w-full rounded-field border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    required
                  />
                  <p className="mt-1 text-[11px] text-muted">
                    Citizens use email; Government officials can use their assigned Centre ID or email.
                  </p>
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
                    className="mt-1 w-full rounded-field border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  className="w-full !min-h-[46px] text-sm font-bold"
                >
                  Sign In
                </Button>

                {/* Quick Autofill helper for Presentation & Demo */}
                <div className="mt-4 rounded-field border border-line/60 bg-surface-2 p-3 text-xs text-muted">
                  <div className="font-semibold text-ink">Quick Role Fill:</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => fillDemoCredentials("citizen")}
                      className="flex-1 min-h-[38px] rounded border border-line bg-surface px-3 py-1.5 font-medium hover:border-accent hover:text-accent transition-colors active:scale-95 text-center flex items-center justify-center gap-1.5"
                    >
                      <Icon name="camera" size={14} className="text-accent" />
                      Citizen (Local)
                    </button>
                    <button
                      type="button"
                      onClick={() => fillDemoCredentials("authority")}
                      className="flex-1 min-h-[38px] rounded border border-line bg-surface px-3 py-1.5 font-medium hover:border-accent hover:text-accent transition-colors active:scale-95 text-center flex items-center justify-center gap-1.5"
                    >
                      <Icon name="shield" size={14} className="text-accent" />
                      Authority (PMC-CENTRE-401)
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
                    placeholder="Aarav Sharma"
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
                    placeholder="user@example.org"
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

                {/* Government Official Centre ID Verification */}
                {regRole === "authority" && (
                  <div className="rounded-card border border-accent/40 bg-accent-soft/30 p-3.5 space-y-3 animate-rise">
                    <div className="flex items-center gap-2 text-xs font-bold text-accent uppercase tracking-wider">
                      <Icon name="shield" size={15} />
                      <span>Official Government Credentials</span>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-ink" htmlFor="reg-centre-id">
                        Municipal Centre / Ward ID <span className="text-accent">*</span>
                      </label>
                      <input
                        id="reg-centre-id"
                        type="text"
                        value={regCentreId}
                        onChange={(e) => setRegCentreId(e.target.value.toUpperCase())}
                        placeholder="e.g. PMC-CENTRE-401 or WARD-04"
                        className="mt-1 w-full rounded-field border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent font-mono tracking-wide"
                        required={regRole === "authority"}
                      />
                      <p className="mt-1 text-[11px] text-muted">
                        Verification proof: Required municipal center or ward badge ID for authority triage.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-ink" htmlFor="reg-department">
                        Department / Designation (optional)
                      </label>
                      <input
                        id="reg-department"
                        type="text"
                        value={regDepartment}
                        onChange={(e) => setRegDepartment(e.target.value)}
                        placeholder="e.g. Solid Waste & Sanitation Bureau"
                        className="mt-1 w-full rounded-field border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  className="w-full !min-h-[46px] text-sm font-bold mt-2"
                >
                  Create Account
                </Button>
              </form>
            )}

            {/* Tab 3: Quick Role Preview */}
            {tab === "demo" && (
              <div className="mt-5 space-y-3">
                <p className="text-xs text-muted">
                  Instant one-click access for evaluation:
                </p>
                {ROLES.map((r) => {
                  const u = users.data?.find((x) => x.role === r.role) ?? FALLBACK_USERS[r.role];
                  const isBusy = demoBusy === u.id || demoBusy === r.role;
                  const displayName =
                    u.name === "Demo Citizen A"
                      ? "Aarav Sharma"
                      : u.name === "Demo Ward Authority"
                      ? "Priya Verma (Officer)"
                      : u.name.replace(/^Demo\s+/i, "");
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
                          <span className="truncate text-xs font-normal text-faint">{displayName}</span>
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

          {/* Comfortable, prominent mobile-friendly return link */}
          <div className="mt-6 text-center">
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-2 rounded-field px-4 py-2.5 text-sm sm:text-base font-semibold text-muted hover:text-ink hover:bg-surface-2 border border-transparent hover:border-line transition-all active:scale-95"
            >
              <Icon name="chevronLeft" size={17} />
              <span>Return to PlasticWatch Overview</span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
