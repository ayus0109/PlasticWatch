import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";
import type { UserRole } from "./api/client";
import { Shell } from "./components/Shell";
import { Card, EmptyState, Spinner } from "./components/ui";
import { homeFor, useSession } from "./store/auth";

const Login = lazy(() => import("./pages/Login"));
const Report = lazy(() => import("./pages/Report"));
const MyReports = lazy(() => import("./pages/MyReports"));
const MapPage = lazy(() => import("./pages/MapPage"));
const HotspotDetail = lazy(() => import("./pages/HotspotDetail"));
const Queue = lazy(() => import("./pages/Queue"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Reviews = lazy(() => import("./pages/Reviews"));
const TeamTasks = lazy(() => import("./pages/TeamTasks"));
const TeamTask = lazy(() => import("./pages/TeamTask"));

const ROLE_NAME: Record<UserRole, string> = {
  citizen: "citizens",
  authority: "the authority",
  team: "cleanup teams",
};

function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const session = useSession();
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.role !== role) {
    return (
      <Shell>
        <Card className="mx-auto max-w-lg">
          <EmptyState
            icon="shield"
            title={`This page is for ${ROLE_NAME[role]}`}
            action={
              <Link
                to={homeFor(session.user.role)}
                className="inline-flex min-h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-semibold text-accent-fg"
              >
                Go to my home
              </Link>
            }
          >
            You're signed in with a different demo role. Use the role switcher at the top right
            to change roles.
          </EmptyState>
        </Card>
      </Shell>
    );
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
    <div className="grid min-h-[60vh] place-items-center text-accent">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/report" element={<RequireRole role="citizen"><Report /></RequireRole>} />
          <Route path="/my-reports" element={<RequireRole role="citizen"><MyReports /></RequireRole>} />
          <Route path="/map" element={<RequireRole role="authority"><MapPage /></RequireRole>} />
          <Route path="/hotspots/:id" element={<RequireRole role="authority"><HotspotDetail /></RequireRole>} />
          <Route path="/queue" element={<RequireRole role="authority"><Queue /></RequireRole>} />
          <Route path="/dashboard" element={<RequireRole role="authority"><Dashboard /></RequireRole>} />
          <Route path="/tasks" element={<RequireRole role="authority"><Tasks /></RequireRole>} />
          <Route path="/reviews" element={<RequireRole role="authority"><Reviews /></RequireRole>} />
          <Route path="/team/tasks" element={<RequireRole role="team"><TeamTasks /></RequireRole>} />
          <Route path="/team/tasks/:id" element={<RequireRole role="team"><TeamTask /></RequireRole>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
