import { canChooseSaveLocation } from "../lib/campaignExport";

/**
 * Shown under a download control when the browser cannot open a save dialog of its own (Safari,
 * Firefox), so the file quietly lands in the browser's download folder. The control is a real link, so
 * the context menu can still put the file wherever the user wants.
 */
export function SaveLocationHint() {
  if (canChooseSaveLocation()) return null;
  return (
    <p className="muted">
      This browser saves downloads into its own folder. To choose the place, right-click the button and
      pick &ldquo;Download linked file as…&rdquo;, or turn on &ldquo;ask where to save&rdquo; in the
      browser settings.
    </p>
  );
}
