import { useI18n } from "../i18n/I18nContext";
import { canChooseSaveLocation } from "../lib/campaignExport";

/**
 * Shown under a download control when the browser cannot open a save dialog of its own (Safari,
 * Firefox), so the file quietly lands in the browser's download folder. The control is a real link, so
 * the context menu can still put the file wherever the user wants.
 */
export function SaveLocationHint() {
  const { t } = useI18n();
  if (canChooseSaveLocation()) return null;
  return <p className="muted">{t("saveHint.text")}</p>;
}
