/**
 * /team/tasks/:id — route map + stop list. At each stop the team checks in (browser
 * GPS, or a pin); the API records arrival only within ARRIVE_RADIUS_M of the hotspot.
 * Then two after-photos; the verdict is a suggestion an authority reviews.
 */
import { useState } from "react";
import { Link, useParams } from "react-router";
import { api, type ArriveResponse, type TaskDetail, type TaskStop } from "../api/client";
import { useApi } from "../api/hooks";
import { AfterPhotos } from "../components/AfterPhotos";
import { VerdictChip } from "../components/BeforeAfter";
import { Icon } from "../components/Icon";
import { RouteMap } from "../components/map/RouteMap";
import { PinPicker, type LatLon } from "../components/PinPicker";
import { Shell } from "../components/Shell";
import { distance, duration, RouteSourceNote, TaskStatusChip } from "../components/TaskBits";
import { useToast } from "../components/Toast";
import { BandChip, Button, Card, EmptyState, ErrorState, SimulatedBadge, Skeleton, cx } from "../components/ui";
import { metres } from "../lib/format";

function StopCard({
  stop,
  taskId,
  active,
  onChanged,
}: {
  stop: TaskStop;
  taskId: number;
  active: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState<LatLon | null>(null);
  const [lastMiss, setLastMiss] = useState<number | null>(null);
  const [retaking, setRetaking] = useState(false);

  const checkIn = async (at: LatLon) => {
    setBusy(true);
    try {
      const r = await api.post<ArriveResponse>(`/tasks/${taskId}/stops/${stop.id}/arrive`, at);
      if (r.within_range) {
        toast("ok", `Checked in at stop ${stop.seq} (${metres(r.distance_m)} from the hotspot).`);
        setLastMiss(null);
        onChanged();
      } else {
        setLastMiss(r.distance_m);
      }
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const viaGps = () => {
    if (!("geolocation" in navigator)) return setPinMode(true);
    navigator.geolocation.getCurrentPosition(
      (p) => checkIn({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => setPinMode(true),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const state = stop.completed_at ? "done" : stop.arrived_at ? "here" : "todo";
  return (
    <Card className={cx("p-4", active && state === "todo" && "ring-2 ring-accent/40")}>
      <div className="flex items-center gap-3">
        <span
          className={cx(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold",
            state === "done" ? "bg-ok-soft text-ok" : state === "here" ? "bg-accent text-accent-fg" : "bg-surface-2",
          )}
        >
          {state === "done" ? <Icon name="check" size={16} /> : stop.seq}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Hotspot #{stop.hotspot_id}</div>
          <div className="text-xs text-muted">
            {state === "done"
              ? stop.review_decision === "confirm_resolved"
                ? "Confirmed resolved by an authority"
                : "Cleaned — waiting for the authority's review"
              : state === "here"
                ? "You're on site"
                : "Not visited yet"}
          </div>
        </div>
        <BandChip band={stop.priority_band} />
      </div>

      {state === "todo" && stop.review_decision === "reject" ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-danger-soft p-2.5 text-sm text-danger">
          <Icon name="refresh" size={16} className="mt-0.5 shrink-0" />
          The authority asked for this spot to be cleaned again. Check in when you're back.
        </p>
      ) : null}
      {state === "todo" ? (
        <div className="mt-3 space-y-2">
          {pinMode ? (
            <>
              <PinPicker value={pin} near={{ lat: stop.lat, lon: stop.lon }} onChange={setPin} />
              <Button variant="primary" icon="pin" disabled={!pin} loading={busy} onClick={() => pin && checkIn(pin)} className="w-full">
                Check in at this pin
              </Button>
            </>
          ) : (
            <div className="flex gap-2">
              <Button variant="primary" icon="crosshair" loading={busy} onClick={viaGps} className="flex-1">
                I've arrived
              </Button>
              <Button icon="pin" onClick={() => setPinMode(true)}>
                Use a pin
              </Button>
            </div>
          )}
          {lastMiss !== null ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-sim-bg p-2.5 text-sm text-sim-fg">
              <Icon name="alert" size={16} className="mt-0.5" />
              You're {metres(lastMiss)} from the hotspot — move closer to check in.
            </p>
          ) : null}
        </div>
      ) : null}
      {state === "here" ? <AfterPhotos taskId={taskId} stopId={stop.id} onDone={onChanged} /> : null}
      {state === "done" && stop.verdict ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 p-2.5">
          <span className="flex items-center gap-2 text-sm">
            Suggested verdict <VerdictChip verdict={stop.verdict} />
          </span>
          {stop.review_decision == null && !retaking ? (
            <Button variant="ghost" icon="camera" onClick={() => setRetaking(true)}>
              Retake photos
            </Button>
          ) : null}
        </div>
      ) : null}
      {state === "done" && retaking && stop.review_decision == null ? (
        <AfterPhotos
          taskId={taskId}
          stopId={stop.id}
          retake
          onDone={() => {
            setRetaking(false);
            onChanged();
          }}
        />
      ) : null}
    </Card>
  );
}

export default function TeamTask() {
  const { id } = useParams();
  const task = useApi<TaskDetail>(id ? `/tasks/${id}` : null);
  const t = task.data;
  const next = t?.stops.find((s) => !s.completed_at);

  return (
    <Shell>
      <div className="mx-auto max-w-3xl">
        <Link to="/team/tasks" className="mb-4 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
          <Icon name="chevronLeft" size={16} /> My tasks
        </Link>
        {task.error ? (
          task.error.status === 404 ? (
            <Card>
              <EmptyState icon="truck" title="Task not found">It may be assigned to another team, or the demo was reset.</EmptyState>
            </Card>
          ) : (
            <ErrorState message={task.error.message} onRetry={task.refetch} />
          )
        ) : !t ? (
          <Skeleton className="h-96 rounded-card" />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
                  Task #{t.id} {t.is_simulated ? <SimulatedBadge /> : null}
                </h1>
                <p className="text-sm text-muted">
                  {t.stops.length} stop(s) · {distance(t.route_distance_m)} · about {duration(t.route_duration_s)}
                </p>
              </div>
              <TaskStatusChip status={t.status} />
            </div>
            <Card className="overflow-hidden p-3">
              <RouteMap task={t} />
              <div className="px-1 pt-2">
                <RouteSourceNote task={t} />
              </div>
            </Card>
            <div className="space-y-3">
              {t.stops.map((s) => (
                <StopCard key={s.id} stop={s} taskId={t.id} active={s.id === next?.id} onChanged={task.refetch} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
