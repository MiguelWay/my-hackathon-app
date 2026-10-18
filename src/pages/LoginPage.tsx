import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PasswordInput } from "../components/PasswordInput";
import { IDLE_MINUTES } from "../lib/idle";

/** The login screen's two doors. Both check the same credentials; a door only picks the view. */
type Door = "administrator" | "operator";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const timedOut = params.get("timeout") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Door | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Which button was pressed. Enter inside a field submits through the first one — the administrator.
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const door: Door = submitter?.value === "operator" ? "operator" : "administrator";
    setError(null);
    setPending(door);
    try {
      await login(email, password, door === "operator");
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Log in</h1>
        {timedOut && !error && (
          <p className="ok">
            You were signed out after {IDLE_MINUTES} minutes without activity.
          </p>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <PasswordInput
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        {/* Two doors, one credential check. The account's own role decides what it actually gets, so a
            super-admin may enter either view and an operator account only the operator's. */}
        <div className="btn-row">
          <button type="submit" value="administrator" disabled={pending !== null}>
            {pending === "administrator" ? "…" : "Enter as administrator"}
          </button>
          <button type="submit" value="operator" className="secondary" disabled={pending !== null}>
            {pending === "operator" ? "…" : "Enter as operator"}
          </button>
        </div>
        <p className="muted">
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
      </form>
    </div>
  );
}
