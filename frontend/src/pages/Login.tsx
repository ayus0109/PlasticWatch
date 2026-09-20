import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import type { DemoUser, UserRole } from "../api/client";
import { useApi } from "../api/hooks";
import { Icon, type IconName } from "../components/Icon";
import { Logo, ThemeToggle } from "../components/Shell";
import { ErrorState, Skeleton, cx } from "../components/ui";
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
      <div className="mx-auto grid min-h-full max-w-6xl gap-10 px-5 py-8 md:grid-cols-[1.05fr_1fr] md:items-center md:gap-16 md:py-16">
        <div className="animate-rise">
          <div className="flex items-center justify-between">
            <Logo />
            <div className="md:hidden">
              <ThemeToggle />
            </div>
          </div>
          <h1 className="font-display mt-10 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            Find plastic hotspots.
            <br />
            <span className="text-accent">Clean the worst first.</span>
          </h1>
          <p className="mt-5 max-w-md text-body leading-relaxed text-muted">
            Citizens report likely plastic waste with a photo. Duplicates merge into hotspots,
            ranked by impact near drains and water — then people, not the model, decide what
            happens.
          </p>
          <ul className="mt-8 space-y-3">
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

        <div className="animate-rise [animation-delay:80ms]">
          <div className="rounded-card border border-line bg-surface p-6 shadow-raised sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Choose a demo role</h2>
                <p className="mt-1 text-sm text-muted">
                  Seeded demo accounts — no passwords. This is not real authentication.
                </p>
              </div>
              <div className="hidden md:block">
                <ThemeToggle />
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {users.error ? (
                <ErrorState message={users.error.message} onRetry={users.refetch} />
              ) : !users.data ? (
                [0, 1].map((i) => <Skeleton key={i} className="h-[76px] w-full rounded-card" />)
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
                        "group flex w-full items-center gap-4 rounded-card border border-line bg-surface p-4 text-left",
                        "transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-accent hover:shadow-raised",
                        "disabled:opacity-60",
                      )}
                    >
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-field bg-surface-2 text-ink transition-colors group-hover:bg-accent group-hover:text-accent-fg">
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
    </div>
  );
}
