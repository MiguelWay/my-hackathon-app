import { useState, type ChangeEvent } from "react";
import { useI18n } from "../i18n/I18nContext";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** "current-password" on login, "new-password" on sign-up — helps password managers. */
  autoComplete?: string;
  minLength?: number;
  autoFocus?: boolean;
}

/**
 * Password field with a show/hide toggle, so a typo is visible instead of costing a failed sign-in.
 * The toggle is a real button (aria-pressed) rather than a checkbox, so it never submits the form.
 */
export function PasswordInput({ value, onChange, autoComplete, minLength, autoFocus }: Props) {
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();

  return (
    <span className="pw-row">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        autoComplete={autoComplete}
        minLength={minLength}
        autoFocus={autoFocus}
        required
      />
      <button
        type="button"
        className="secondary"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? t("password.hideAria") : t("password.showAria")}
        title={visible ? t("password.hideAria") : t("password.showAria")}
      >
        {visible ? t("password.hide") : t("password.show")}
      </button>
    </span>
  );
}
