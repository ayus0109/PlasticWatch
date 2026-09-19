/** /team/tasks — the cleanup team's assigned routes. */
import { Link } from "react-router";
import type { TaskSummary } from "../api/client";
import { useApi } from "../api/hooks";
import { Icon } from "../components/Icon";
import { Shell } from "../components/Shell";
import { distance, duration, TaskStatusChip } from "../components/TaskBits";
import { Card, EmptyState, ErrorState, SimulatedBadge, Skeleton } from "../components/ui";
import { timeAgo } from "../lib/format";

export default function TeamTasks() {
  const tasks = useApi<TaskSummary[]>("/tasks");
  const open = (tasks.data ?? []).filter((t) => t.status !== "done");
  const done = (tasks.data ?? []).filter((t) => t.status === "done");

  const card = (t: TaskSummary) => (
    <Link
      key={t.id}
      to={`/team/tasks/${t.id}`}
      className="flex min-h-20 items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card transition-[transform,border-color] hover:-translate-y-0.5 hover:border-accent"
    >
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
        <Icon name="truck" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-semibold">
          Task #{t.id} {t.is_simulated ? <SimulatedBadge /> : null}
        </span>
        <span className="block text-sm text-muted">
          {t.stop_count} stop(s) · {distance(t.route_distance_m)} · about {duration(t.route_duration_s)}
        </span>
        <span className="block text-xs text-faint">Assigned {timeAgo(t.created_at)}</span>
      </span>
      <TaskStatusChip status={t.status} />
    </Link>
  );

  return (
    <Shell>
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-2xl font-bold tracking-tight">My cleanup tasks</h1>
        <p className="mt-1 mb-5 text-sm text-muted">Follow the route, check in at each stop, upload after-photos.</p>
        {tasks.error ? (
          <ErrorState message={tasks.error.message} onRetry={tasks.refetch} />
        ) : !tasks.data ? (
          <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-card" />)}</div>
        ) : tasks.data.length === 0 ? (
          <Card>
            <EmptyState icon="truck" title="No tasks assigned">An authority will assign cleanup routes here.</EmptyState>
          </Card>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">{open.length ? open.map(card) : <p className="text-sm text-muted">Nothing open — nice work.</p>}</section>
            {done.length ? (
              <section className="space-y-3">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Done</h2>
                {done.map(card)}
              </section>
            ) : null}
          </div>
        )}
      </div>
    </Shell>
  );
}
