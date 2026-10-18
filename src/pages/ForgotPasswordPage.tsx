import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

/**
 * Asks for the account's email. The server always answers the same way, whether or not the address
 * exists, so this screen cannot be used to discover who has a login.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/forgot", { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Forgot password</h1>
        {sent ? (
          <>
            <p className="ok">
              If an account exists for that email, a reset link has been sent. It expires in 30
              minutes.
            </p>
            <p className="muted">
              <Link to="/login">Back to log in</Link>
            </p>
          </>
        ) : (
          <>
            <p className="muted">
              Type the email of your account and we will send a link to set a new password.
            </p>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button disabled={busy}>{busy ? "…" : "Send reset link"}</button>
            <p className="muted">
              <Link to="/login">Back to log in</Link>
            </p>
          </>
        )}
      </form>
    </div>
  );
}
