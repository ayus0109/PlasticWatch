/**
 * /reviews (authority) — the before/after approval gate (SPEC §14, USERFLOW). Every
 * cleanup the team claims waits here until a human compares the photos side by side
 * and confirms or rejects it. Nothing is resolved automatically.
 */
import { Link } from "react-router";
import type { BeforeAfterRecord } from "../api/client";
import { useApi } from "../api/hooks";
import { BeforeAfterCompare, BeforeAfterFacts, ReviewPanel, VerdictChip } from "../components/BeforeAfter";
import { Icon } from "../components/Icon";
import { Shell } from "../components/Shell";
import { Card, EmptyState, ErrorState, SectionTitle, SimulatedBadge, Skeleton, StatusChip } from "../components/ui";
import { dateTime, timeAgo } from "../lib/format";

function ReviewCard({ record, onDone }: { record: BeforeAfterRecord; onDone: () => void }) {
  return (
    <Card className="p-4 sm:p-5 animate-rise">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/hotspots/${record.hotspot_id}`} className="font-display text-xl font-bold hover:text-accent">
            Hotspot #{record.hotspot_id}
          </Link>
          <VerdictChip verdict={record.verdict} />
          {record.is_simulated ? <SimulatedBadge /> : null}
        </div>
        <span className="text-xs text-muted" title={dateTime(record.created_at)}>
          Task #{record.task_id} · photos {timeAgo(record.created_at)}
        </span>
      </header>
      <BeforeAfterCompare record={record} />
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <BeforeAfterFacts record={record} />
        <ReviewPanel record={record} onDone={onDone} />
      </div>
    </Card>
  );
}

export default function Reviews() {
  const pending = useApi<BeforeAfterRecord[]>("/before-after", { pending: true });
  const all = useApi<BeforeAfterRecord[]>("/before-after");
  const refresh = () => {
    pending.refetch();
    all.refetch();
  };
  const done = (all.data ?? []).filter((r) => r.review_decision != null).slice(0, 8);

  return (
    <Shell>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Cleanup reviews</h1>
        <p className="mt-1 text-sm text-muted">
          Compare before and after photos. Only your confirmation resolves a hotspot.
        </p>
      </div>

      <section className="space-y-4">
        <SectionTitle hint={pending.data ? `${pending.data.length} waiting` : undefined}>Awaiting your decision</SectionTitle>
        {pending.error ? (
          <ErrorState message={pending.error.message} onRetry={pending.refetch} />
        ) : !pending.data ? (
          <Skeleton className="h-96 w-full rounded-card" />
        ) : pending.data.length === 0 ? (
          <Card>
            <EmptyState icon="scale" title="No cleanups waiting">
              When a team uploads after-photos, the before/after comparison appears here.
            </EmptyState>
          </Card>
        ) : (
          pending.data.map((r) => <ReviewCard key={r.id} record={r} onDone={refresh} />)
        )}
      </section>

      {done.length ? (
        <section className="mt-8">
          <SectionTitle hint="most recent first">Reviewed</SectionTitle>
          <Card className="divide-y divide-line">
            {done.map((r) => (
              <Link
                key={r.id}
                to={`/hotspots/${r.hotspot_id}`}
                className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-surface-2"
              >
                <span className="font-semibold">Hotspot #{r.hotspot_id}</span>
                <VerdictChip verdict={r.verdict} />
                <span className="flex items-center gap-1 text-sm text-muted">
                  <Icon name={r.review_decision === "confirm_resolved" ? "check" : "x"} size={14} />
                  {r.review_decision === "confirm_resolved" ? "Confirmed" : "Rejected"} by {r.reviewed_by_name ?? "an authority"}
                </span>
                <span className="ml-auto">{r.hotspot_status ? <StatusChip status={r.hotspot_status} /> : null}</span>
              </Link>
            ))}
          </Card>
        </section>
      ) : null}
    </Shell>
  );
}
