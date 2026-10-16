import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { PasswordInput } from "../components/PasswordInput";

/** The server's own rule (`server/src/validate.ts`); this only makes the browser agree with it early. */
const MIN_PASSWORD_LENGTH = 8;

export function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (next !== again) {
      setError("The two new passwords are not the same.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/password", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setAgain("");
      setNotice("Password changed. Every other session on this account has been signed out.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Change password</h1>
      <p className="muted">
        Your own session stays open; every other one on this account is signed out. This screen needs the
        password you have now — if that is what you have lost, no sign-in screen can help you, and the way
        back is the recovery command in the deployment notes.
      </p>

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      <form className="card form-stack" onSubmit={onSubmit}>
        <label>
          Password you have now
          <PasswordInput
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            autoFocus
          />
        </label>
        <label>
          New password
          <PasswordInput
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
        </label>
        <label>
          New password again
          <PasswordInput
            value={again}
            onChange={setAgain}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
        </label>
        <button disabled={busy}>{busy ? "…" : "Change password"}</button>
      </form>
    </div>
  );
}
