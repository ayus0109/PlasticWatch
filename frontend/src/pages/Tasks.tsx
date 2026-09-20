/**
 * /tasks (authority) — cleanup tasks and a planner. Only VERIFIED hotspots can be
 * added (the API returns 409 otherwise); creating a task schedules each one.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  api,
  type DemoUser,
  type HotspotFeatureCollection,
  type TaskDetail,
  type TaskSummary,
  type WardFeatureCollection,
} from "../api/client";
import { useApi } from "../api/hooks";
import { VerdictChip } from "../components/BeforeAfter";
import { Icon } from "../components/Icon";
import { RouteMap } from "../components/map/RouteMap";
import { Shell } from "../components/Shell";
import { distance, duration, RouteSourceNote, TaskStatusChip } from "../components/TaskBits";
import { useToast } from "../components/Toast";
import { friendlyError } from "../components/VerifyPanel";
import {
  BandChip,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SectionTitle,
  SimulatedBadge,
  Skeleton,
  cx,
} from "../components/ui";
import { impact, timeAgo } from "../lib/format";

function wardsCentre(w?: WardFeatureCollection): [number, number] | null {
  const coords = (w?.features ?? []).flatMap((f) =>
    ((f.geometry as { coordinates: number[][][][] }).coordinates ?? []).flat(2),
  );
  if (!coords.length) return null;
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function Planner({ onCreated }: { onCreated: (t: TaskDetail) => void }) {
  const toast = useToast();
  const verified = useApi<HotspotFeatureCollection>("/hotspots", { status: "verified" });
  const users = useApi<DemoUser[]>("/auth/demo-users");
  const wards = useApi<WardFeatureCollection>("/wards");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const teams = (users.data ?? []).filter((u) => u.role === "team");
  const [team, setTeam] = useState<string>("");
  const depot = useMemo(() => wardsCentre(wards.data), [wards.data]);

  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const submit = async () => {
    const teamId = team || teams[0]?.id;
    if (!teamId || !depot || !picked.size) return;
    setBusy(true);
    try {
      const t = await api.post<TaskDetail>("/tasks", {
        hotspot_ids: [...picked],
        team_id: teamId,
        depot,
      });
      toast("ok", `Task #${t.id} created with ${t.stops.length} stop(s); hotspots are now scheduled.`);
      setPicked(new Set());
      verified.refetch();
      onCreated(t);
    } catch (e) {
      toast("error", friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const features = verified.data?.features ?? [];
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Plan a cleanup route</h2>
      <p className="mt-1 text-sm text-muted">
        Only hotspots an authority has verified can be scheduled. Pick them, choose a team, and
        the route is ordered for you.
      </p>
      <div className="mt-4 max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {verified.error ? (
          <ErrorState message={verified.error.message} onRetry={verified.refetch} />
        ) : !verified.data ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)
        ) : features.length === 0 ? (
          <EmptyState icon="shield" title="No verified hotspots waiting">
            Verify hotspots from the queue first — then they can be scheduled here.
          </EmptyState>
        ) : (
          features.map((f) => {
            const p = f.properties;
            const on = picked.has(p.id);
            return (
              <label
                key={p.id}
                className={cx(
                  "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors",
                  on ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2",
                )}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="h-4 w-4 accent-[var(--pw-accent)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    Hotspot #{p.id} <span className="font-normal text-muted">· {p.ward_name ?? "—"}</span>
                  </span>
                  <span className="block text-xs text-muted">
                    Impact {impact(p.impact_score)} · {p.report_count} reports
                  </span>
                </span>
                <BandChip band={p.priority_band} />
              </label>
            );
          })
        )}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">Team</span>
          <select
            value={team || teams[0]?.id || ""}
            onChange={(e) => setTeam(e.target.value)}
            className="min-h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <Button variant="primary" icon="route" disabled={!picked.size || !depot} loading={busy} onClick={submit}>
            Create task ({picked.size})
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-faint">Depot: centre of the mapped wards.</p>
    </Card>
  );
}

export default function Tasks() {
  const tasks = useApi<TaskSummary[]>("/tasks");
  const [open, setOpen] = useState<number | null>(null);
  const detail = useApi<TaskDetail>(open ? `/tasks/${open}` : null);

  return (
    <Shell>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Cleanup tasks</h1>
        <p className="mt-1 text-sm text-muted">Routes for cleanup teams over verified hotspots.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <section className="space-y-3">
          <SectionTitle hint={tasks.data ? `${tasks.data.length} tasks` : undefined}>Tasks</SectionTitle>
          {tasks.error ? (
            <ErrorState message={tasks.error.message} onRetry={tasks.refetch} />
          ) : !tasks.data ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-card" />)
          ) : tasks.data.length === 0 ? (
            <Card>
              <EmptyState icon="route" title="No cleanup tasks yet">Plan one on the right.</EmptyState>
            </Card>
          ) : (
            tasks.data.map((t) => (
              <Card key={t.id} className="overflow-hidden">
                <button
                  onClick={() => setOpen(open === t.id ? null : t.id)}
                  className="flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left hover:bg-surface-2"
                  aria-expanded={open === t.id}
                >
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-muted">
                    <Icon name="route" size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-semibold">
                      Task #{t.id} {t.is_simulated ? <SimulatedBadge /> : null}
                    </span>
                    <span className="block text-xs text-muted">
                      {t.assigned_team_name} · {t.stop_count} stop(s) · {distance(t.route_distance_m)} ·{" "}
                      {duration(t.route_duration_s)} · {timeAgo(t.created_at)}
                    </span>
                  </span>
                  <TaskStatusChip status={t.status} />
                  <Icon name="chevronRight" size={16} className={cx("text-faint transition-transform", open === t.id && "rotate-90")} />
                </button>
                {open === t.id ? (
                  <div className="border-t border-line p-4">
                    {detail.data?.id === t.id ? (
                      <div className="space-y-3">
                        <RouteMap task={detail.data} height="h-64" />
                        <RouteSourceNote task={detail.data} />
                        <ol className="space-y-1 text-sm">
                          {detail.data.stops.map((s) => (
                            <li key={s.id} className="flex items-center gap-2">
                              <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-xs font-bold">{s.seq}</span>
                              <Link to={`/hotspots/${s.hotspot_id}`} className="font-semibold hover:text-accent">
                                Hotspot #{s.hotspot_id}
                              </Link>
                              <span className="ml-auto flex items-center gap-2 text-xs text-muted">
                                {s.completed_at && s.verdict ? <VerdictChip verdict={s.verdict} /> : null}
                                {s.completed_at
                                  ? s.review_decision === "confirm_resolved"
                                    ? "confirmed"
                                    : "awaiting review"
                                  : s.arrived_at
                                    ? "team on site"
                                    : s.review_decision === "reject"
                                      ? "sent back"
                                      : "to do"}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : (
                      <Skeleton className="h-64 w-full rounded-xl" />
                    )}
                  </div>
                ) : null}
              </Card>
            ))
          )}
        </section>
        <aside>
          <Planner
            onCreated={(t) => {
              tasks.refetch();
              setOpen(t.id);
            }}
          />
        </aside>
      </div>
    </Shell>
  );
}
