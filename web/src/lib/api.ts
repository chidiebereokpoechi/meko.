import { API, getAccessToken, refresh } from "./auth.ts";

// Authenticated JSON fetch. Attaches the in-memory bearer token; on a 401 it transparently tries
// one refresh (rotating the cookie, §9h) and retries once.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = () =>
    fetch(`${API}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(getAccessToken() ? { authorization: `Bearer ${getAccessToken()}` } : {}),
        ...init.headers,
      },
    });

  let res = await send();
  if (res.status === 401 && (await refresh())) res = await send();

  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ""));
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("application/json") ? await res.json() : (undefined as T)) as T;
}

export class ApiError extends Error {
  constructor(public status: number, body: string) {
    super(`API ${status}: ${body}`);
  }
}
