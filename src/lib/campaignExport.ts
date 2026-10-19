import { translate } from "../i18n/runtime";
import { baseUrl } from "./api";

// Two ways to save an export:
//   Download   — the file goes to the browser's download folder (which the browser itself can be told
//                to ask about), and the control is a real link, so right-click → "Download linked file
//                as…" chooses the folder in any browser.
//   Save as…   — Chrome and Edge only: the browser's own save dialog, which picks folder and name.
// Firefox and Safari have no such dialog for a page to call, hence the separate, clearly labelled
// control instead of hijacking every download.

interface SavePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

interface SaveHandle {
  name: string;
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

type SavePicker = (options?: SavePickerOptions) => Promise<SaveHandle>;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The browser's save dialog, when it has one a page may call. */
function savePicker(): SavePicker | undefined {
  const w = window as unknown as { showSaveFilePicker?: SavePicker };
  return typeof w.showSaveFilePicker === "function" ? w.showSaveFilePicker.bind(window) : undefined;
}

/** Whether this browser can open a save dialog at all. */
export const canChooseSaveLocation = (): boolean => savePicker() !== undefined;

/** The export URL of one campaign of the caller's own company, for use as a real link. */
export const campaignExportUrl = (campaignId: number): string =>
  `${baseUrl}/campaigns/${campaignId}/export`;

/** The same for a campaign of any customer, on the platform Customers screen. */
export const adminCampaignExportUrl = (campaignId: number): string =>
  `${baseUrl}/admin/campaigns/${campaignId}/export`;

/** The chain report of the caller's own company: the original ID, then every resend. */
export const chainsExportUrl = (): string => `${baseUrl}/returns/chains/export`;

/** One campaign's return package list (returned and resent IDs), for use as a real link. */
export const returnListExportUrl = (campaignId: number): string =>
  `${baseUrl}/returns/campaigns/${campaignId}/return-list/export`;

/** One campaign's separate "Returns + Store ID" report, for use as a real link. */
export const storeReportExportUrl = (campaignId: number): string =>
  `${baseUrl}/returns/campaigns/${campaignId}/store-report/export`;

/** The name the server gives the chain report, so the save dialog can suggest it before it is built. */
export const CHAINS_EXPORT_FILENAME = "resend-chains.xlsx";

/** The name the server gives the file, so the save dialog can suggest it before the file is built. */
export function exportFileName(campaignId: number, campaignName: string): string {
  const slug =
    campaignName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "campaign";
  return `campaign-${campaignId}-${slug}.xlsx`;
}

async function fetchExport(url: string, fallbackName: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && "error" in body) message = String(body.error);
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const named = /filename="([^"]+)"/.exec(disposition);
  return {
    blob: await res.blob(),
    filename: named?.[1] ?? fallbackName,
  };
}

/**
 * Downloads the export into the browser's download folder and returns the file name. This never opens a
 * dialog, so it works everywhere — including browsers (and automated windows) where a save dialog cannot
 * be shown.
 */
export async function downloadExport(url: string, fallbackName = "export.xlsx"): Promise<string> {
  const { blob, filename } = await fetchExport(url, fallbackName);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
  return filename;
}

/** What a save attempt did, so the screen can say it exactly. */
export interface SaveResult {
  /** The name the file was saved under, or null when the user closed the dialog. */
  name: string | null;
  /** True when the browser would not show a dialog, so the file was downloaded the ordinary way. */
  viaDownload: boolean;
}

/** The sentence every screen shows after a save attempt, so they all word it the same way. */
export function saveNotice(result: SaveResult): string {
  if (result.viaDownload) {
    return translate("export.savedToDownload", { name: result.name ?? "" });
  }
  if (result.name === null) return translate("export.saveCancelled");
  return translate("export.savedTo", { name: result.name });
}

/**
 * Asks the browser's save dialog where to put the export, then writes it there.
 *
 * Returns `name`: the name it was saved under, or null when the user closed the dialog, and
 * `viaDownload`: true when the dialog could not be shown at all, in which case the file was downloaded
 * the ordinary way instead — a refusal must never look like a failure.
 */
export async function saveExportAs(url: string, suggestedName: string): Promise<SaveResult> {
  const picker = savePicker();
  if (!picker) throw new Error(translate("export.noDialog"));

  // Asked first, while the click that started this is still fresh: the request can take a moment, and a
  // dialog opened too late is refused.
  const asked = Date.now();
  let handle: SaveHandle;
  try {
    handle = await picker({
      suggestedName,
      types: [
        {
          description: translate("export.excelDescription"),
          accept: { [XLSX_MIME]: [".xlsx"] },
        },
      ],
    });
  } catch (err) {
    const name = (err as { name?: string }).name;
    // A dialog the user closed: respect that, and save nothing.
    if (name === "AbortError" && Date.now() - asked > 250) {
      return { name: null, viaDownload: false };
    }
    // Anything else — including an abort that came back instantly, which means the browser never showed
    // a dialog (an automated window does this) — falls back to the ordinary download.
    return { name: await downloadExport(url, suggestedName), viaDownload: true };
  }

  const { blob } = await fetchExport(url, suggestedName);
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return { name: handle.name, viaDownload: false };
}
