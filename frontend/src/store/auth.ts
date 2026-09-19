/**
 * Demo session (CLAUDE.md §8: seeded demo users + a role switcher — no real auth).
 *
 * A tiny external store: the token lives in localStorage purely as a convenience so a
 * page refresh keeps the chosen role. useSession() re-renders on login/logout.
 */
import { useSyncExternalStore } from "react";
// client.ts imports getToken/logout from here; neither module calls the other at load
// time, so this cycle is safe.
import { api, type DemoUser, type TokenResponse, type UserRole } from "../api/client";

export interface Session {
  token: string;
  user: DemoUser;
  expiresAt: string;
}

const KEY = "pw-session";
const listeners = new Set<() => void>();

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return new Date(s.expiresAt).getTime() > Date.now() ? s : null;
  } catch {
    return null;
  }
}

let session: Session | null = load();

function emit(next: Session | null): void {
  session = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — the session still works for this tab */
  }
  listeners.forEach((l) => l());
}

export function getToken(): string | null {
  return session?.token ?? null;
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => session,
  );
}

export async function loginAs(pick: { role?: UserRole; user_id?: string }): Promise<Session> {
  const res = await api.post<TokenResponse>("/auth/demo-login", pick);
  const next = { token: res.token, user: res.user, expiresAt: res.expires_at };
  emit(next);
  return next;
}

export function logout(): void {
  emit(null);
}

export function homeFor(role: UserRole): string {
  switch (role) {
    case "citizen":
      return "/report";
    case "authority":
      return "/map";
    case "team":
      return "/team/tasks";
  }
}
