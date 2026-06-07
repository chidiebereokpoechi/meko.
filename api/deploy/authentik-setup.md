# Authentik + Google login for meko.

meko delegates authentication to a self-hosted **Authentik** IdP. Authentik brokers upstream
providers (Google now; Apple/others later with zero meko code change). meko is a single confidential
OIDC client and still issues its own session — see [meko-auth-oidc-plan.md](../../meko-auth-oidc-plan.md).

## 1. Run Authentik

Optional compose overlay (separate Postgres + Redis from meko's). Run from `api/`.

Authentik needs two secrets. `AUTHENTIK_SECRET_KEY` must **persist across restarts** — changing it
invalidates existing sessions — so write them to a gitignored env file once:

```bash
cd api
printf 'AUTHENTIK_SECRET_KEY=%s\nPG_PASS=%s\n' \
  "$(openssl rand -base64 60 | tr -d '\n')" \
  "$(openssl rand -base64 24 | tr -d '\n')" > deploy/authentik.env

docker compose --env-file deploy/authentik.env -f deploy/docker-compose.authentik.yml up -d
```

The overlay pins compose project `meko-authentik`, so it gets its own network/volumes and a `down`
never touches meko's main `deploy` stack.

First boot runs migrations (~30–60s; expect a transient 502). When ready, open
`http://localhost:9000/if/flow/initial-setup/` to set the `akadmin` password.

## 2. Google as a social source

Verified against Authentik **2026.5** + the current Google Cloud console (June 2026).

1. Google Cloud Console → **Google Auth Platform → Clients → Create client** → type **Web
   application**. (Google renamed "APIs & Services → OAuth consent screen / Credentials" to
   "Google Auth Platform" in 2025; configure the consent screen there too — see §2a.)
2. Authorized redirect URI: `https://<authentik-host>/source/oauth/callback/google/`
   (dev: `http://localhost:9000/source/oauth/callback/google/`).
3. Copy the **Client ID** + **Client secret**.
4. Authentik admin → **Directory → Federation and Social login → New Source → Google OAuth Source**.
   Set a name; **Slug** = `google` (must match the callback URL above); paste the Google client ID
   into **Consumer key** and the secret into **Consumer secret**; **Finish**.
5. Show the button on the login page: **Flows and Stages → Stages →** edit
   `default-authentication-identification` → add the Google source under **Sources**.

### 2a. Google Auth Platform (consent screen)
- **Audience**: `External` (any Google account) unless meko is org-only (`Internal`).
- **Scopes**: only `openid`, `email`, `profile` (non-sensitive → no Google verification review).
- **Publishing status**: `Production` (Testing caps ~100 users + 7-day refresh-token expiry).
- Google always shows its own one-time consent screen; it can't be disabled. Keep the
  Authentik provider on **implicit** consent (§3) so there's no second prompt.

## 3. OIDC provider + application for meko

1. Authentik admin → **Applications → Providers → Create → OAuth2/OpenID Provider**:
   - **Authorization flow**: `default-provider-authorization-implicit-consent` (first-party app —
     no consent screen; pick the `…-explicit-consent` flow only if you want users to approve scopes).
   - **Client type**: `Confidential` → copy the generated **Client ID** + **Client Secret**.
   - **Redirect URIs**: `http://localhost:3000/api/auth/oidc/callback` (prod: your `MEKO_BASE_URL`).
     Strict match — must equal `OIDC_REDIRECT_URI` exactly.
   - **Signing Key**: the default certificate (exposes the JWKS meko verifies against).
   - Scopes default to `openid profile email` (meko requests exactly these).
2. Authentik → **Applications → Applications → Create**, bind it to that provider. Note the app
   **slug**.
3. The issuer meko needs is `https://<authentik-host>/application/o/<app-slug>` — confirm via
   `https://<authentik-host>/application/o/<app-slug>/.well-known/openid-configuration`.

## 4. Point meko at it

In `api/.env`:

```
OIDC_ISSUER=https://<authentik-host>/application/o/<app-slug>
OIDC_CLIENT_ID=<from provider>
OIDC_CLIENT_SECRET=<from provider>
OIDC_REDIRECT_URI=http://localhost:3000/api/auth/oidc/callback
MEKO_WEB_URL=http://localhost:5173
```

Restart the API. "Continue with Google" appears on the meko login screen. Leaving `OIDC_ISSUER`
empty disables it (routes 404) — password login is unaffected either way.

## 5. Limit who can sign up (optional)
By default anyone who can authenticate with Google gets a meko account. To lock it down, in `api/.env`:

```
MEKO_SIGNUP_MODE=invite
MEKO_BOOTSTRAP_EMAILS=you@example.com
```

In `invite` mode a **new** account is created only for an email that has a pending workspace invite
(or is in `MEKO_BOOTSTRAP_EMAILS`). Existing users always log in. Applies to both Google and password
`/signup`. Blocked Google logins land back on the meko login screen with an "invite-only" message;
the attempt is logged as `auth.signup_blocked`. Add your own email to `MEKO_BOOTSTRAP_EMAILS` so you
can create the first admin account, then invite everyone else from inside meko.

## Notes
- meko links a Google login to an existing password account **only if the email is verified**
  (Google emails are). Unverified → a separate account, to block takeover.
- Apple is intentionally out of scope on this branch (needs the $99 Apple Developer Program and a
  signed-JWT client secret); add it later as another Authentik source — no meko change.
