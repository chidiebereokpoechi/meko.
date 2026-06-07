// Access-token storage per §9g: the short-lived access token lives ONLY in this module's memory —
// never localStorage/sessionStorage (XSS-reachable). The refresh token is an HttpOnly cookie the
// browser manages; we never see it. On load we silently refresh to repopulate the access token.

export const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

let accessToken: string | null = null;

export const getAccessToken = () => accessToken;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

// Refresh sends the HttpOnly cookie automatically (credentials: include). Returns true if a new
// access token was obtained.
//
// Single-flight: refresh tokens rotate on every use and reuse revokes the whole family (§9h), so
// concurrent callers (a burst of 401s, multiple tabs' first request) MUST share one request —
// otherwise the second send a just-rotated token and the server revokes everyone. While a refresh
// is in flight, every caller awaits the same promise.
let inFlight: Promise<boolean> | null = null;
export function refresh(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch(`${API}/api/auth/refresh`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      const { accessToken: tok } = (await res.json()) as { accessToken: string };
      accessToken = tok;
      return true;
    } catch {
      // Network error / API down — treat as unauthenticated rather than hanging the boot screen.
      accessToken = null;
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function login(email: string, password: string): Promise<void> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Invalid credentials");
  accessToken = ((await res.json()) as { accessToken: string }).accessToken;
}

export async function signup(email: string, password: string, displayName: string): Promise<void> {
  const res = await fetch(`${API}/api/auth/signup`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, displayName }),
  });
  if (!res.ok)
    throw new Error(
      res.status === 409 ? "Email already registered" : res.status === 403 ? "meko. is invite-only — ask an admin to invite your email." : "Signup failed",
    );
  accessToken = ((await res.json()) as { accessToken: string }).accessToken;
}

export async function logout(): Promise<void> {
  await fetch(`${API}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
  accessToken = null;
}
