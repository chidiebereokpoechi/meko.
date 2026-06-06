# Authentik + Google login for meko.

meko delegates authentication to a self-hosted **Authentik** IdP. Authentik brokers upstream
providers (Google now; Apple/others later with zero meko code change). meko is a single confidential
OIDC client and still issues its own session — see [meko-auth-oidc-plan.md](../../meko-auth-oidc-plan.md).

## 1. Run Authentik

Optional compose overlay (separate Postgres + Redis from meko's):

```bash
docker compose -f deploy/docker-compose.authentik.yml up -d
```

First boot: open `http://localhost:9000/if/flow/initial-setup/` to set the `akadmin` password.

## 2. Google as a social source

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID** (Web app).
2. Authorized redirect URI: `https://<authentik-host>/source/oauth/callback/google/`
   (dev: `http://localhost:9000/source/oauth/callback/google/`).
3. Copy the client ID + secret.
4. Authentik → **Directory → Federation & Social login → Create → Google OAuth Source**. Paste the
   ID/secret. Slug must be `google` to match the callback URL above.
5. Add the Google source to the default **authentication flow** (Stages → the identification stage's
   "Sources") so the button renders on the login page.

## 3. OIDC provider + application for meko

1. Authentik → **Applications → Providers → Create → OAuth2/OpenID Provider**:
   - Client type: **Confidential** → copy the generated **Client ID** + **Client Secret**.
   - Redirect URIs: `http://localhost:3000/api/auth/oidc/callback` (prod: your `MEKO_BASE_URL`).
   - Scopes: `openid`, `profile`, `email`.
   - Signing key: default (exposes the JWKS meko verifies against).
2. Authentik → **Applications → Create**, bind it to that provider. Note the app **slug**.
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

## Notes
- meko links a Google login to an existing password account **only if the email is verified**
  (Google emails are). Unverified → a separate account, to block takeover.
- Apple is intentionally out of scope on this branch (needs the $99 Apple Developer Program and a
  signed-JWT client secret); add it later as another Authentik source — no meko change.
