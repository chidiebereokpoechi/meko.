import { useState } from "react";
import { login, signup } from "../lib/auth.ts";

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <div className="grid h-screen place-items-center bg-slate-50">
      <form className="card flex w-80 flex-col gap-3 p-6" onSubmit={submit}>
        <h1 className="heading text-2xl text-primary">meko</h1>
        <p className="text-slate-400">{mode === "login" ? "Sign in to your boards" : "Create an account"}</p>
        {mode === "signup" && (
          <input className="field" placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        )}
        <input className="field" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          className="field"
          type="password"
          placeholder="Password (min 8)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        {err && <div className="rounded-lg bg-red-50 px-3 py-2 font-bold text-red-500">{err}</div>}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Sign in" : "Sign up"}
        </button>
        <button type="button" className="link self-center" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
