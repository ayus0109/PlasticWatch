import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { HashRouter, Link, Navigate, Route, Routes } from "react-router";
import { warmupApi, type UserRole } from "./api/client";
import { EmptyState, Skeleton } from "./components/ui";
import { homeFor, loginAs, useSession } from "./store/auth";

const Login = lazy(() => import("./pages/Login"));
const Report = lazy(() => import("./pages/Report"));
const MyReports = lazy(() => import("./pages/MyReports"));
const Dashboard = lazy(() => import("./pages/Dashboard"));

function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const session = useSession();

  useEffect(() => {
    if (session && session.user.role !== role) {
      loginAs({ role }).catch(() => {});
    }
  }, [session, role]);

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (session.user.role !== role) {
    return <PageLoading />;
  }

  return <>{children}</>;
}

function Home() {
  const session = useSession();
  return <Navigate to={session ? homeFor(session.user.role) : "/login"} replace />;
}

function NotFound() {
  return (
    <div className="grid min-h-full place-items-center p-6">
      <EmptyState icon="map" title="Nothing here" action={<Link className="font-semibold text-accent" to="/">Back to PlasticWatch</Link>}>
        That page doesn't exist.
      </EmptyState>
    </div>
  );
}

function PageLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56 rounded-lg" />
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_380px]">
        <Skeleton className="h-[42dvh] rounded-card md:h-[460px]" />
        <Skeleton className="hidden h-[460px] rounded-card lg:block" />
      </div>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    warmupApi();
  }, []);

  return (
    <HashRouter>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/report" element={<RequireRole role="citizen"><Report /></RequireRole>} />
          <Route path="/my-reports" element={<RequireRole role="citizen"><MyReports /></RequireRole>} />
          <Route path="/dashboard" element={<RequireRole role="authority"><Dashboard /></RequireRole>} />
          {/* The old fragmented authority tabs all live on the dashboard now. */}
          {["/map", "/queue", "/tasks", "/reviews", "/hotspots/:id", "/team/tasks", "/team/tasks/:id"].map(
            (path) => (
              <Route key={path} path={path} element={<Navigate to="/dashboard" replace />} />
            ),
          )}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
