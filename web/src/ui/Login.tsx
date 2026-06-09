import { useEffect, useState } from "react";
import { API, login } from "../lib/auth.ts";
import { Button, TextField } from "./kit/index.ts";

// Map the callback's ?auth_error code (set on a failed OIDC round trip) to a human message.
const OIDC_ERRORS: Record<string, string> = {
  email_unverified: "Your email isn't verified by your identity provider, so it can't be linked to an existing account.",
  access_denied: "Sign-in was cancelled.",
  signup_closed: "meko. is invite-only — ask an admin to invite your email.",
};
function readOidcError(): string | null {
  const code = new URLSearchParams(window.location.search).get("auth_error");
  if (!code) return null;
  // Strip the param so a refresh doesn't re-show the error.
  window.history.replaceState({}, "", window.location.pathname);
  return OIDC_ERRORS[code] ?? "Sign-in failed. Please try again.";
}

// Google "G" mark (official four-colour logo).
function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(() => readOidcError());
  const [busy, setBusy] = useState(false);
  // OIDC providers configured on the server (e.g. Authentik, Google) — only these get a button.
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    fetch(`${API}/api/auth/oidc/providers`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((d) => setProviders(d.providers ?? []))
      .catch(() => setProviders([]));
  }, []);
  // Carry the current path (e.g. /invite/<token>) through the IdP round trip so an invited user
  // lands back on the invite after authenticating. There is no self-signup — accounts are created
  // only when an invited (or bootstrap-allowlisted) email authenticates.
  const ret = encodeURIComponent(window.location.pathname + window.location.search);
  const oidcUrl = (providerId: string) => `${API}/api/auth/oidc/login?provider=${providerId}&return=${ret}`;

  // <form onSubmit> → Enter submits. Login only; no signup from this screen.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(email, password);
      onAuthed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-screen place-items-center bg-slate-100">
      <form className="flex w-80 flex-col gap-4 rounded-xl border-2 border-line-subtle bg-white px-8 py-9" onSubmit={submit}>
        <div>
          <img src="/meko.png" alt="meko." className="h-12 w-12 rounded-xl" />
          <p className="mt-3 text-slate-400">Sign in to your boards</p>
        </div>
        {providers.map((p) => (
          <a
            key={p.id}
            href={oidcUrl(p.id)}
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-line bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            {p.id === "google" && <GoogleG />} Continue with {p.label}
          </a>
        ))}
        {providers.length > 0 && (
          <div className="flex items-center gap-3 text-[11px] font-bold uppercase text-slate-300">
            <span className="h-0.5 flex-1 bg-slate-100" /> or <span className="h-0.5 flex-1 bg-slate-100" />
          </div>
        )}
        <TextField name="email" type="email" label="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <TextField
          name="password"
          type="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
          error={err}
        />
        <Button type="submit" loading={busy}>
          Sign in
        </Button>
        <p className="text-center text-xs text-slate-400">Access is invite-only. Open your invite link to join.</p>
      </form>
    </div>
  );
}
