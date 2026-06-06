# meko. — OIDC login via Authentik (Google now, Apple later)

Implementation plan for the `feat/authentik-oidc` branch. Adds "Continue with Google" backed by a
self-hosted **Authentik** IdP, without disturbing meko's existing session machinery.

## Design decision: Authentik authenticates, meko keeps the session

meko already bootstraps every page load by calling `refresh()`, which mints an in-memory access
token from the HttpOnly refresh cookie. We exploit that:

```
Browser ── /api/auth/oidc/login ──▶ Authentik ──▶ Google ──▶ Authentik
   ▲                                                              │
   │                          302 to web app                      ▼
   └──────────────── /api/auth/oidc/callback  (issues meko refresh family, sets cookie)
```

The callback verifies the OIDC code, JIT-provisions the meko user, then calls the **existing**
`startSession()` — same rotating refresh family + cookie meko issues for password login today — and
302s to the web app. The SPA's existing boot `refresh()` then mints the access token. So:

- **Authentik is touched only at login.** No per-session storage of Authentik's tokens; meko's
  refresh family governs session lifetime, exactly as now.
- **Downstream is unchanged:** bearer guard, WS ticket (§5g), refresh rotation + family revoke
  (§9h), `api.ts` retry, `App.tsx` phases — no edits.
- **Invariants 3/4/5 preserved** (WS ticket, token-in-memory + cookie, rotate-on-every-use).
- Broker pattern: adding Apple/another provider later = Authentik config only, **zero meko code**.

Password login is **kept** as a fallback (reversible, low-risk). Frontend leads with Google.

## No new dependencies

OIDC is hand-rolled with `node:crypto` + `fetch`, matching meko's existing hand-rolled HS256
(`auth/tokens.ts`). RS256 ID-token verification: import the JWKS JWK via
`crypto.createPublicKey({ format: "jwk" })` and `crypto.verify`.

## Backend changes (`api/`)

### 1. Config (`src/config.ts`)
Add (all optional; OIDC disabled when `OIDC_ISSUER` empty):
- `OIDC_ISSUER` — Authentik issuer base (discovery at `{issuer}/.well-known/openid-configuration`)
- `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` — confidential client from Authentik
- `OIDC_REDIRECT_URI` — `{MEKO_BASE_URL}/api/auth/oidc/callback`
- `MEKO_WEB_URL` — where the callback 302s after login (the SPA origin)
- `oidcEnabled` derived export (issuer + client id + secret all present)

### 2. `src/auth/oidc.ts` (new)
- `discover()` — fetch + cache the discovery doc (authorization/token endpoints, jwks_uri).
- `jwks()` — fetch + cache JWKS; re-fetch on unknown `kid` (key rotation), small cache TTL.
- `buildAuthorizeUrl({state, nonce, codeChallenge})` — scopes `openid profile email`, S256 PKCE.
- `exchangeCode(code, codeVerifier)` — POST token endpoint (client_secret_basic), returns id_token.
- `verifyIdToken(idToken, nonce)` — RS256 sig via JWKS, validate `iss`/`aud`/`exp`/`iat`/`nonce`;
  return `{ sub, email, emailVerified, name }`. Logs `securityEvent` on every rejection.

### 3. OIDC transaction store (Redis)
Login generates `state`, `nonce`, PKCE `code_verifier`; stores `{state,nonce,verifier}` in Redis
keyed by a random `tx` id (TTL 600s). A short-lived `HttpOnly; Secure; SameSite=Lax; Path=/api/auth`
cookie carries the `tx` id (Lax so it survives the top-level redirect back from Authentik). Callback
reads the cookie, GETDELs the tx, and checks the returned `state` matches. State check is mandatory
(CSRF). Cookie cleared after.

### 4. Routes (`src/http/routes/auth.ts`, extend)
- `GET /api/auth/oidc/login` → 404 if `!oidcEnabled`; create tx, set tx cookie, 302 to authorize URL.
- `GET /api/auth/oidc/callback` → 404 if disabled; on `?error=` from Authentik, 302 to web with an
  error flag; else verify tx+state, exchange, verify id_token, **require `emailVerified`**, provision,
  `startSession`, 302 to `MEKO_WEB_URL`. These two are **GET** (browser navigations) and are exempt
  from the JSON-body auth rate-limiter group; keep an IP rate-limit on `oidc/login`.

### 5. JIT provisioning (`src/auth/provision.ts` or inline)
`provisionOidcUser({ sub, email, emailVerified, name })`:
1. Find user by `oidcSub == sub` → return (update displayName if changed).
2. Else, **only if `emailVerified`**, find by `email`; if found, link (`oidcSub = sub`) and return.
   (Never link on unverified email — account-takeover vector.)
3. Else insert `{ email, displayName: name ?? email, oidcSub: sub, passwordHash: null }`.
Upsert guarded by the new unique index on `oidc_sub`; on insert race, retry the lookup.

### 6. Schema (`src/db/schema.ts`) + migration
Add to `users`: `oidcSub: text("oidc_sub")` + `uniqueIndex("users_oidc_sub_idx")` (partial / nullable
unique). Run `bun run db:generate` then `db:migrate` (DIRECT URL, §3d).

### Unchanged
`tokens.ts`, `ws-ticket.ts`, `middleware.ts`, `password.ts`, refresh/logout routes, `index.ts` WS.

## Frontend changes (`web/`)

- `src/ui/Login.tsx` — add a primary "Continue with Google" button:
  `window.location.href = ${API}/api/auth/oidc/login`. Keep the email/password form below it.
- `src/App.tsx` — no auth logic change. Optionally read a `?auth_error` query the callback may set
  and surface it on the login screen.
- `src/lib/auth.ts` / `api.ts` — unchanged.

## Authentik setup (ops, documented in `deploy/`)
- Compose service block for Authentik (server + worker + its own Postgres + Redis) — added to
  `deploy/` as an optional overlay, not wired into the app's compose by default.
- In Authentik: create a **Google** social source (id/secret from Google Cloud Console; redirect
  `{authentik}/source/oauth/callback/google/`). Create an **OAuth2/OIDC Provider** (confidential,
  redirect = `OIDC_REDIRECT_URI`, scopes `openid profile email`) + bind an **Application**.
- `.env.example` gains the `OIDC_*` + `MEKO_WEB_URL` keys.

## Tests (`api/`)
- `verifyIdToken`: sign a token with a throwaway RSA key, serve it as JWKS, assert accept; assert
  reject on bad sig / wrong `aud` / wrong `iss` / expired / bad `nonce`.
- `provisionOidcUser`: new user creates row; second call same `sub` returns same row; verified-email
  match links; unverified-email match does NOT link.
- Live Authentik round-trip: opt-in/skipped (like the S3 + Chromium paths).

## Out of scope (this branch)
Apple sign-in, Authentik-driven remote logout / back-channel logout, deleting password auth.
