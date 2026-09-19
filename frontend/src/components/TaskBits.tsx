import type { TaskDetail, TaskSummary } from "../api/client";
import { metres } from "../lib/format";
import { Icon } from "./Icon";
import { Chip } from "./ui";

export const TASK_STATUS: Record<TaskSummary["status"], { label: string; tone: "neutral" | "info" | "ok" }> = {
  planned: { label: "Planned", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  done: { label: "Done", tone: "ok" },
};

export function TaskStatusChip({ status }: { status: TaskSummary["status"] }) {
  const m = TASK_STATUS[status];
  return (
    <Chip tone={m.tone} icon={status === "done" ? "check" : status === "in_progress" ? "truck" : "clock"}>
      {m.label}
    </Chip>
  );
}

export function RouteSourceNote({ task }: { task: TaskDetail }) {
  return task.route_source === "ors" ? (
    <p className="flex items-center gap-1.5 text-xs text-muted">
      <Icon name="route" size={13} /> Road route optimised by OpenRouteService.
    </p>
  ) : (
    <p className="flex items-center gap-1.5 text-xs text-muted">
      <Icon name="info" size={13} /> Straight-line order (road routing unavailable — nearest-first fallback).
    </p>
  );
}

export function duration(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export function distance(m: number | null | undefined): string {
  return metres(m ?? null);
}
