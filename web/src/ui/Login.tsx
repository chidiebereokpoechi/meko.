import { useState } from "react";
import { API, login, signup } from "../lib/auth.ts";
import { Button, TextField } from "./kit/index.ts";

// Map the callback's ?auth_error code (set on a failed OIDC round trip) to a human message.
const OIDC_ERRORS: Record<string, string> = {
  email_unverified: "Your Google email isn't verified, so it can't be linked to an existing account.",
  access_denied: "Google sign-in was cancelled.",
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
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState<string | null>(() => readOidcError());
  const [busy, setBusy] = useState(false);

  // <form onSubmit> → Enter submits.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === "signup") await signup(email, password, displayName || email.split("@")[0]!);
      else await login(email, password);
      onAuthed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-screen place-items-center bg-slate-100">
      <form className="flex w-80 flex-col gap-4 rounded-xl border-2 border-slate-100 bg-white px-8 py-9" onSubmit={submit}>
        <div>
          <h1 className="heading text-2xl text-primary">meko.</h1>
          <p className="mt-1 text-slate-400">{mode === "login" ? "Sign in to your boards" : "Create an account"}</p>
        </div>
        <a
          href={`${API}/api/auth/oidc/login`}
          className="flex items-center justify-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
        >
          <GoogleG /> Continue with Google
        </a>
        <div className="flex items-center gap-3 text-[11px] font-bold uppercase text-slate-300">
          <span className="h-0.5 flex-1 bg-slate-100" /> or <span className="h-0.5 flex-1 bg-slate-100" />
        </div>
        {mode === "signup" && (
          <TextField name="displayName" label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
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
          {mode === "login" ? "Sign in" : "Sign up"}
        </Button>
        <button type="button" className="text-xs font-bold text-primary hover:text-primary-dark" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
