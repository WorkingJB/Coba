// Thin client for the Better Auth HTTP API (server/auth.ts), Step 3 / Phase A2.
// The SPA is served from the SAME origin as the auth routes (`/api/auth/*`), so
// the session cookie is set and sent automatically — JS never sees the token
// (it's HttpOnly). We only ever read back the public user via get-session.
//
// An account is required for ONLINE play; bot play stays anonymous and never
// touches this module.

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

const BASE = "/api/auth";

// Better Auth returns errors as JSON `{ message, code, ... }` with a 4xx status.
// Pull a human message out, falling back to a sensible default per call site.
async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { message?: string } | null;
  return data?.message ?? fallback;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // explicit: carry the session cookie even if cross-origin
    body: JSON.stringify(body),
  });
}

export async function signUp(email: string, password: string, name: string): Promise<AuthUser> {
  const res = await postJson("sign-up/email", { email, password, name });
  if (!res.ok) throw new Error(await readError(res, "Could not create account."));
  const data = (await res.json()) as { user: AuthUser };
  return data.user;
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const res = await postJson("sign-in/email", { email, password });
  if (!res.ok) throw new Error(await readError(res, "Invalid email or password."));
  const data = (await res.json()) as { user: AuthUser };
  return data.user;
}

export async function signOut(): Promise<void> {
  await postJson("sign-out", {});
}

/** Current user from the session cookie, or null if signed out / expired. */
export async function getSession(): Promise<AuthUser | null> {
  const res = await fetch(`${BASE}/get-session`, { credentials: "include" });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { user?: AuthUser } | null;
  return data?.user ?? null;
}
