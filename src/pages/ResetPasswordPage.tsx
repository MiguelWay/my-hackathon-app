import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { PasswordInput } from "../components/PasswordInput";
import { useI18n } from "../i18n/I18nContext";

const MIN_PASSWORD_LENGTH = 8;

/** The page a reset link opens. The token comes from the query string and is single-use. */
export function ResetPasswordPage() {
  const { t } = useI18n();
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
      setError(t("reset.mismatch"));
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/reset", { token, newPassword: next });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reset.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-wrap">
        <div className="auth-language">
          <LanguageSwitch />
        </div>
        <div className="card auth-card">
          <h1>{t("reset.titleMissing")}</h1>
          <p className="error">{t("reset.missingToken")}</p>
          <p className="muted">
            <Link to="/forgot-password">{t("reset.forgotLink")}</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-language">
        <LanguageSwitch />
      </div>
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>{t("reset.title")}</h1>
        {done ? (
          <>
            <p className="ok">{t("reset.done")}</p>
            <p className="muted">
              <Link to="/login">{t("reset.loginLink")}</Link>
            </p>
          </>
        ) : (
          <>
            <label>
              {t("reset.newPassword")}
              <PasswordInput
                value={next}
                onChange={setNext}
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                autoFocus
              />
            </label>
            <label>
              {t("reset.newPasswordAgain")}
              <PasswordInput
                value={again}
                onChange={setAgain}
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button disabled={busy}>{busy ? "…" : t("reset.submit")}</button>
          </>
        )}
      </form>
    </div>
  );
}
