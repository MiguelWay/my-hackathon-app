import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { useI18n } from "../i18n/I18nContext";
import { api } from "../lib/api";

/**
 * Asks for the account's email. The server always answers the same way, whether or not the address
 * exists, so this screen cannot be used to discover who has a login.
 */
export function ForgotPasswordPage() {
  const { t } = useI18n();
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
      setError(err instanceof Error ? err.message : t("forgot.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-language">
        <LanguageSwitch />
      </div>
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>{t("forgot.title")}</h1>
        {sent ? (
          <>
            <p className="ok">{t("forgot.sent")}</p>
            <p className="muted">
              <Link to="/login">{t("forgot.back")}</Link>
            </p>
          </>
        ) : (
          <>
            <p className="muted">{t("forgot.instructions")}</p>
            <label>
              {t("forgot.email")}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button disabled={busy}>{busy ? "…" : t("forgot.submit")}</button>
            <p className="muted">
              <Link to="/login">{t("forgot.back")}</Link>
            </p>
          </>
        )}
      </form>
    </div>
  );
}
