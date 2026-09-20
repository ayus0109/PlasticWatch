/**
 * Typed API client. Every type comes from src/api/schema.d.ts, generated from the
 * backend's frozen OpenAPI contract (`npm run gen:api`) — never hand-written.
 */
import { getToken, logout, setSessionToken } from "../store/auth";
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
export type BandCount = S["BandCount"];
export type WardStats = S["WardStats"];
export type TaskSummary = S["TaskSummary"];
export type TaskDetail = S["TaskDetail"];
export type TaskCreateRequest = S["TaskCreateRequest"];
export type TaskStop = S["TaskStop"];
export type ArriveResponse = S["ArriveResponse"];
export type BeforeAfterRecord = S["BeforeAfterRecord"];
export type ReviewResponse = S["ReviewResponse"];
export type ReviewDecision = S["ReviewDecision"];
export type Verdict = S["Verdict"];
export type ResetDemoResponse = S["ResetDemoResponse"];

/** Browser -> Vite proxy -> FastAPI (see vite.config.ts). Override for a hosted API. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? "/api").replace(/\/+$/, "");

/** Build absolute or proxied URL safely without double slashes. */
export function buildUrl(path: string): URL {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (/^https?:\/\//i.test(API_BASE)) {
    return new URL(`${API_BASE}${cleanPath}`);
  }
  return new URL(`${API_BASE}${cleanPath}`, window.location.origin);
}

/** Absolute URL for a stored media path such as "uploads/reports/<id>.jpg". */
export function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const clean = path.replace(/^\/+/, "");
  return `${API_BASE}/${clean}`;
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
  if (status >= 500) return { message: "The server hit a temporary problem. Please try again." };
  return { message: `Request failed (${status}).` };
}

interface RequestOptions {
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
}

const RETRYABLE_STATUSES = new Set([0, 502, 503, 504]);
const MAX_NETWORK_RETRIES = 3;
const RETRY_DELAYS_MS = [1200, 2500, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let autoLoginPromise: Promise<string | null> | null = null;

/** Seamless auto-login so demo views never fail due to missing or expired tokens. */
async function autoAuthenticate(): Promise<string | null> {
  if (autoLoginPromise) return autoLoginPromise;

  autoLoginPromise = (async () => {
    try {
      const isCitizen = window.location.hash.includes("report");
      const targetRole: UserRole = isCitizen ? "citizen" : "authority";
      const loginUrl = buildUrl("/auth/demo-login");
      const res = await fetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: targetRole }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as TokenResponse;
      if (data?.token) {
        setSessionToken(data.token, data.user, data.expires_at);
        return data.token;
      }
      return null;
    } catch {
      return null;
    } finally {
      autoLoginPromise = null;
    }
  })();

  return autoLoginPromise;
}

async function fetchWithRetry(
  url: URL,
  init: RequestInit,
  attempt = 0
): Promise<Response> {
  try {
    const res = await fetch(url, init);
    // Render free-tier cold-start gateway 502/503/504
    if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_NETWORK_RETRIES) {
      await sleep(RETRY_DELAYS_MS[attempt] || 2000);
      return fetchWithRetry(url, init, attempt + 1);
    }
    return res;
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    if (attempt < MAX_NETWORK_RETRIES) {
      await sleep(RETRY_DELAYS_MS[attempt] || 2000);
      return fetchWithRetry(url, init, attempt + 1);
    }
    throw new ApiError(
      0,
      "PlasticWatch server is waking up or temporarily unreachable. Please retry in a moment."
    );
  }
}

async function request<T>(
  method: string,
  path: string,
  opts: RequestOptions = {},
  isAuthRetry = false
): Promise<T> {
  const url = buildUrl(path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const token = getToken();

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  const res = await fetchWithRetry(url, { method, headers, body, signal: opts.signal });

  // If existing token was rejected (401), auto-renew session and retry once transparently
  if (res.status === 401 && !isAuthRetry && !path.startsWith("/auth") && token) {
    const refreshed = await autoAuthenticate();
    if (refreshed) {
      return request<T>(method, path, opts, true);
    }
    logout();
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
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

/** Keepalive warmup so Render free-tier starts spinning up in the background early. */
export function warmupApi(): void {
  try {
    const pingUrl = buildUrl("/ping");
    fetch(pingUrl, { method: "GET" }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) =>
    request<T>("GET", path, { query, signal }),
  post: <T>(path: string, json?: unknown) => request<T>("POST", path, { json }),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
};
