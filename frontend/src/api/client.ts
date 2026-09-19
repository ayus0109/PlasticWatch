/**
 * Typed API client. Every type comes from src/api/schema.d.ts, generated from the
 * backend's frozen OpenAPI contract (`npm run gen:api`) — never hand-written.
 */
import { getToken, logout } from "../store/auth";
import type { components } from "./schema";

type S = components["schemas"];
export type DemoUser = S["DemoUser"];
export type TokenResponse = S["TokenResponse"];
export type HotspotStatus = S["HotspotStatus"];
export type PriorityBand = S["PriorityBand"];
export type EvidenceBand = S["EvidenceBand"];
export type ConfidenceTier = S["ConfidenceTier"];
export type RejectReason = S["RejectReason"];
export type VerifyDecision = S["VerifyDecision"];
export type UserRole = S["UserRole"];
export type LocationSource = S["LocationSource"];
export type HotspotFeatureCollection = S["HotspotFeatureCollection"];
export type HotspotFeature = S["HotspotFeature"];
export type HotspotProperties = S["HotspotProperties"];
export type HotspotDetail = S["HotspotDetail"];
export type HotspotEvent = S["HotspotEvent"];
export type ScoreBreakdown = S["ScoreBreakdown"];
export type ScoreFactor = S["ScoreFactor"];
export type ReportSummary = S["ReportSummary"];
export type ReportDetail = S["ReportDetail"];
export type ReportCreateResponse = S["ReportCreateResponse"];
export type Detection = S["Detection"];
export type GeoFeatureCollection = S["GeoFeatureCollection"];
export type WardFeatureCollection = S["WardFeatureCollection"];
export type VerifyRequest = S["VerifyRequest"];
export type VerifyResponse = S["VerifyResponse"];
export type AnalyticsSummary = S["AnalyticsSummary"];
export type AnalyticsTrend = S["AnalyticsTrend"];
export type AnalyticsWards = S["AnalyticsWards"];
export type TaskSummary = S["TaskSummary"];
export type TaskDetail = S["TaskDetail"];
export type TaskCreateRequest = S["TaskCreateRequest"];
export type TaskStop = S["TaskStop"];
export type ArriveResponse = S["ArriveResponse"];
export type BeforeAfterRecord = S["BeforeAfterRecord"];
export type ReviewResponse = S["ReviewResponse"];
export type ResetDemoResponse = S["ResetDemoResponse"];

/** Browser -> Vite proxy -> FastAPI (see vite.config.ts). Override for a hosted API. */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "/api";

/** Absolute URL for a stored media path such as "uploads/reports/<id>.jpg". */
export function mediaUrl(path: string | null | undefined): string | undefined {
  return path ? `${API_BASE}/${path}` : undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail: unknown;

  constructor(status: number, message: string, code?: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Turn FastAPI's error bodies into one readable sentence. */
function describe(status: number, body: unknown): { message: string; code?: string } {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return { message: detail };
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = detail as { message?: string; code?: string };
    if (d.message) return { message: d.message, code: d.code };
  }
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string; loc?: unknown[] };
    const field = first.loc?.slice(1).join(".");
    return { message: `${field ? `${field}: ` : ""}${first.msg ?? "Invalid request"}` };
  }
  if (status === 403) return { message: "Your role is not allowed to do that." };
  if (status === 404) return { message: "Not found." };
  if (status >= 500) return { message: "The server hit a problem. Please try again." };
  return { message: `Request failed (${status}).` };
}

interface RequestOptions {
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "Can't reach the PlasticWatch server. Is the API running?");
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token) logout(); // expired or invalid demo token
    const { message, code } = describe(res.status, data);
    throw new ApiError(res.status, message, code, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) =>
    request<T>("GET", path, { query, signal }),
  post: <T>(path: string, json?: unknown) => request<T>("POST", path, { json }),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
};
