import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router";
import type { DemoUser, UserRole } from "../api/client";
import { useApi } from "../api/hooks";
import { applyTheme, currentTheme, type ThemeMode } from "../lib/theme";
import { homeFor, loginAs, logout, useSession } from "../store/auth";
import { Icon, type IconName } from "./Icon";
import { useToast } from "./Toast";
import { NON_ATTRIBUTION_NOTE } from "../lib/status";
import { cx } from "./ui";

const NAV: Record<UserRole, { to: string; label: string; icon: IconName }[]> = {
  citizen: [
    { to: "/report", label: "Report", icon: "camera" },
    { to: "/scanner", label: "AI Detector", icon: "detect" },
    { to: "/my-reports", label: "My reports", icon: "list" },
  ],
  // The government portal is one page: no tabs to fragment it (PS-08).
  authority: [
    { to: "/dashboard", label: "Dashboard", icon: "map" },
    { to: "/scanner", label: "AI Detector", icon: "detect" },
  ],
  team: [],
};

/**
 * Phones get a thumb-reachable bar instead of tabs. For the government that one page
 * has three views, so the bar switches ?view= on the dashboard (see Dashboard.tsx).
 */
const MOBILE_NAV: Record<UserRole, { to: string; label: string; icon: IconName }[]> = {
  citizen: [
    { to: "/report", label: "Report", icon: "camera" },
    { to: "/scanner", label: "Detector", icon: "detect" },
    { to: "/my-reports", label: "My reports", icon: "list" },
  ],
  authority: [
    { to: "/dashboard?view=map", label: "Map", icon: "map" },
    { to: "/dashboard?view=list", label: "Priorities", icon: "list" },
    { to: "/dashboard?view=kpi", label: "KPIs", icon: "chart" },
    { to: "/scanner", label: "Detector", icon: "detect" },
  ],
  team: [],
};

const ROLE_LABEL: Record<UserRole, string> = {
  citizen: "Local",
  authority: "Government",
  team: "Cleanup crew",
};

/** Only the two PS-08 roles are offered anywhere in the UI. */
const UI_ROLES: ReadonlySet<UserRole> = new Set(["citizen", "authority"]);

export function Logo({
  compact = false,
  className = "",
  onDark = false,
}: {
  compact?: boolean;
  className?: string;
  /** For the landing hero, whose scrim stays dark in BOTH themes. The lockup goes
   *  mono there: the two-tone accent is unreadable on a dark green photograph. */
  onDark?: boolean;
}) {
  return (
    <span className={cx("flex items-center gap-2.5 select-none", className)}>
      <img
        src="/logo-icon.png"
        alt="PlasticWatch"
        className="h-8 w-8 object-contain shrink-0 drop-shadow-sm transition-transform hover:scale-105"
      />
      {compact ? null : (
        <span
          className={cx(
            "font-display text-[17px] font-extrabold tracking-tight",
            onDark ? "text-white" : "text-ink",
          )}
        >
          Plastic{onDark ? "Watch" : <span className="text-accent">Watch</span>}
        </span>
      )}
    </span>
  );
}

/** Nav tabs with an underline that slides to the active tab (CLAUDE.md §9). */
function Tabs({ role }: { role: UserRole }) {
  const location = useLocation();
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const items = NAV[role];
  const active = items.find((i) => location.pathname.startsWith(i.to))?.to;
  const hidden = items.length < 2;

  useLayoutEffect(() => {
    const el = active ? refs.current[active] : null;
    setBar(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [active, role]);

  if (hidden) return null;
  return (
    <nav className="relative hidden h-full items-stretch gap-1 md:flex" aria-label="Main">
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          ref={(el) => {
            refs.current[i.to] = el;
          }}
          className={({ isActive }) =>
            cx(
              "flex items-center gap-2 px-3 text-sm font-semibold transition-colors",
              isActive ? "text-ink" : "text-muted hover:text-ink",
            )
          }
        >
          <Icon name={i.icon} size={16} />
          {i.label}
        </NavLink>
      ))}
      <span
        aria-hidden
        className="absolute bottom-0 h-[2.5px] rounded-full bg-accent transition-all duration-300 ease-out"
        style={{ left: bar?.left ?? 0, width: bar?.width ?? 0, opacity: bar ? 1 : 0 }}
      />
    </nav>
  );
}

function MobileNav({ role }: { role: UserRole }) {
  const location = useLocation();
  const [params] = useSearchParams();
  const items = MOBILE_NAV[role];
  if (items.length < 2) return null;

  const view = params.get("view") ?? "map";
  const isActive = (to: string) => {
    const [path, query] = to.split("?");
    if (location.pathname !== path) return false;
    return query ? query === `view=${view}` : true;
  };

  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-[1000] flex border-t border-line bg-surface/80 backdrop-blur-md md:hidden"
      aria-label="Main"
    >
      {items.map((i) => {
        const active = isActive(i.to);
        return (
          <NavLink
            key={i.to}
            to={i.to}
            aria-current={active ? "page" : undefined}
            className={cx(
              "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-micro font-semibold",
              "transition-colors duration-200 active:scale-[0.97]",
              active ? "text-accent" : "text-muted",
            )}
          >
            <span
              aria-hidden
              className={cx(
                "absolute inset-x-6 top-0 h-[2.5px] rounded-full bg-accent transition-opacity duration-200",
                active ? "opacity-100" : "opacity-0",
              )}
            />
            <Icon name={i.icon} size={20} />
            {i.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function RoleSwitcher() {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const users = useApi<DemoUser[]>(open ? "/auth/demo-users" : null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!session) return null;
  const pick = async (u: DemoUser) => {
    setOpen(false);
    try {
      await loginAs({ user_id: u.id });
      navigate(homeFor(u.role));
      toast("info", `Now acting as ${u.name}.`);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-sm transition-colors hover:border-line-strong"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
          {session.user.name
            .split(" ")
            .map((w) => w[0])
            .slice(-2)
            .join("")}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-label font-semibold">{session.user.name}</span>
          <span className="block text-micro text-muted">
            {session.user.is_simulated ? `${ROLE_LABEL[session.user.role]} (Demo)` : ROLE_LABEL[session.user.role]}
          </span>
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-12 z-[1100] w-64 overflow-hidden rounded-card border border-line bg-surface p-1 shadow-pop animate-rise"
        >
          {session.user.email ? (
            <div className="border-b border-line px-2.5 py-1.5 mb-1">
              <span className="block text-micro font-medium text-muted">Signed in as</span>
              <span className="block text-xs font-semibold text-ink truncate">{session.user.email}</span>
            </div>
          ) : null}
          <p className="px-2.5 pb-1.5 pt-1 text-micro font-semibold uppercase tracking-wider text-faint">
            {session.user.is_simulated ? "Switch demo role" : "Demo roles (Testing)"}
          </p>
          {(users.data ?? []).filter((u) => UI_ROLES.has(u.role)).map((u) => (
            <button
              key={u.id}
              role="menuitem"
              onClick={() => pick(u)}
              className={cx(
                "flex min-h-11 w-full items-center justify-between rounded-field px-2.5 text-left text-sm hover:bg-surface-2",
                u.id === session.user.id && "bg-surface-2",
              )}
            >
              <span>
                <span className="block font-medium">{u.name}</span>
                <span className="block text-xs text-muted">{ROLE_LABEL[u.role]}</span>
              </span>
              {u.id === session.user.id ? <Icon name="check" size={16} className="text-accent" /> : null}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button
            role="menuitem"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="flex min-h-11 w-full items-center gap-2 rounded-field px-2.5 text-sm text-muted hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
  const [mode, setMode] = useState<ThemeMode>(currentTheme());
  const flip = () => {
    const next = mode === "dark" ? "light" : "dark";
    applyTheme(next);
    setMode(next);
    window.dispatchEvent(new CustomEvent("pw-theme", { detail: next }));
  };
  return (
    <button
      onClick={flip}
      aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} theme`}
      className={cx(
        "grid h-11 w-11 place-items-center rounded-full transition-colors active:scale-95",
        onDark
          ? "text-white/80 hover:bg-white/15 hover:text-white"
          : "text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon name={mode === "dark" ? "sun" : "moon"} size={18} />
    </button>
  );
}

/**
 * The frame every signed-in page lives in. `fullBleed` pages (the map) get the
 * whole viewport under the top bar. Every authority view carries the persistent
 * non-attribution note as a strip under the header (CLAUDE.md §2.3) — in the page
 * frame, so it is always visible and can never cover content.
 */
export function Shell({
  children,
  fullBleed = false,
  banner,
}: {
  children: ReactNode;
  fullBleed?: boolean;
  banner?: ReactNode;
}) {
  const session = useSession();
  const role = session?.user.role ?? "citizen";
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-[1000] border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 items-center gap-6 px-4 sm:px-6">
          <NavLink to="/" aria-label="PlasticWatch home" className="-mx-2 flex min-h-11 items-center px-2">
            <Logo />
          </NavLink>
          <Tabs role={role} />
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <RoleSwitcher />
          </div>
        </div>
        {banner}
        {role === "authority" ? (
          <p className="flex items-center justify-center gap-1.5 border-t border-line px-4 py-1 text-center text-micro text-muted">
            <Icon name="info" size={12} className="shrink-0 text-accent" />
            {NON_ATTRIBUTION_NOTE}
          </p>
        ) : null}
      </header>
      <main
        className={cx(
          "flex-1",
          fullBleed ? "relative" : "pb-nav mx-auto w-full max-w-7xl px-4 pt-5 sm:px-6 sm:pt-6 md:pb-12",
        )}
      >
        {children}
      </main>
      <MobileNav role={role} />
    </div>
  );
}

/** Shown while seeded/stub data is on screen (CLAUDE.md §2.2). */
export function SimulatedBanner() {
  return (
    <div className="border-t border-dashed border-sim-line bg-sim-bg px-4 py-1.5 text-center text-xs font-semibold text-sim-fg">
      SIMULATED DEMO DATA — geotags and/or detections on this screen are fabricated for the demo.
    </div>
  );
}
