import { useState } from "react";
import { login, signup } from "../lib/auth.ts";
import { Button, TextField } from "./kit/index.ts";

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState<string | null>(null);
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
