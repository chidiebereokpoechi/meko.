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
export async function refresh(): Promise<boolean> {
  const res = await fetch(`${API}/api/auth/refresh`, { method: "POST", credentials: "include" });
  if (!res.ok) {
    accessToken = null;
    return false;
  }
  const { accessToken: tok } = (await res.json()) as { accessToken: string };
  accessToken = tok;
  return true;
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
  if (!res.ok) throw new Error(res.status === 409 ? "Email already registered" : "Signup failed");
  accessToken = ((await res.json()) as { accessToken: string }).accessToken;
}

export async function logout(): Promise<void> {
  await fetch(`${API}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
  accessToken = null;
}
