import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { PasswordInput } from "../components/PasswordInput";

const MIN_PASSWORD_LENGTH = 8;

/** The page a reset link opens. The token comes from the query string and is single-use. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== again) {
      setError("The two passwords are not the same.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/reset", { token, newPassword: next });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <h1>Reset password</h1>
          <p className="error">That reset link is missing its token. Ask for a new link.</p>
          <p className="muted">
            <Link to="/forgot-password">Forgot password</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Set a new password</h1>
        {done ? (
          <>
            <p className="ok">Your password has been changed. You can now log in.</p>
            <p className="muted">
              <Link to="/login">Log in</Link>
            </p>
          </>
        ) : (
          <>
            <label>
              New password
              <PasswordInput
                value={next}
                onChange={setNext}
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                autoFocus
              />
            </label>
            <label>
              New password again
              <PasswordInput
                value={again}
                onChange={setAgain}
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button disabled={busy}>{busy ? "…" : "Change password"}</button>
          </>
        )}
      </form>
    </div>
  );
}
