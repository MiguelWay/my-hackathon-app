import { useI18n } from "../i18n/I18nContext";

/** A share, rounded to something readable: 0.7%, 12%, 100%. */
function share(part: number, whole: number): string {
  if (whole === 0) return "—";
  const value = (part / whole) * 100;
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}%`;
}

/**
 * The three totals that answer "how are we doing?" — packages sent, returned packages and Resent, the
 * last two with their share of what was sent.
 *
 * Shared so the campaign's returns screen and the company-wide report word them identically: the
 * difference between the two is the scope of the numbers, not how they read.
 */
export function ReturnCounters({
  sent,
  returns,
  resends,
}: {
  sent: number;
  returns: number;
  resends: number;
}) {
  const { t } = useI18n();
  return (
    <div className="stats">
      <div className="stat">
        <span className="stat-number">{sent}</span>
        <span className="muted">{t("counters.sent")}</span>
      </div>
      <div className="stat">
        <span className="stat-number">{returns}</span>
        <span className="muted">
          {t(returns === 1 ? "counters.returnedOne" : "counters.returnedOther")}
        </span>
        <span className="stat-share">
          {t("counters.ofSent", { share: share(returns, sent) })}
        </span>
      </div>
      <div className="stat">
        <span className="stat-number">{resends}</span>
        <span className="muted">{t("counters.resent")}</span>
        <span className="stat-share">
          {t("counters.ofSent", { share: share(resends, sent) })}
        </span>
      </div>
    </div>
  );
}
