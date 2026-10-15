import { baseUrl } from "./api";

// Saving: browsers with the File System Access API (Chrome, Edge) are asked to show a real save dialog,
// where the folder and the file name can be chosen. Firefox and Safari have no equivalent, so there the
// file goes to the browser's download folder under the name the server sent.

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

/** The browser's save picker, when it has one that can be called from a page. */
function savePicker(): SavePicker | undefined {
  const w = window as unknown as { showSaveFilePicker?: SavePicker };
  return typeof w.showSaveFilePicker === "function" ? w.showSaveFilePicker.bind(window) : undefined;
}

/**
 * Whether clicking a download can open a save dialog. Chrome and Edge can; Safari and Firefox cannot,
 * so there the file lands in the browser's own download folder unless the user asks for it explicitly.
 */
export const canChooseSaveLocation = (): boolean => savePicker() !== undefined;

/** The export URL for one campaign, for use as a real link so "download linked file as…" works. */
export const campaignExportUrl = (campaignId: number): string =>
  `${baseUrl}/campaigns/${campaignId}/export`;

/** The same for a campaign of any customer, on the platform Customers screen. */
export const adminCampaignExportUrl = (campaignId: number): string =>
  `${baseUrl}/admin/campaigns/${campaignId}/export`;

/** Hands the blob to the browser's own download machinery (the fallback, and Safari/Firefox's path). */
function saveThroughBrowser(blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
}

/**
 * Fetches one campaign's .xlsx and saves it, returning the name it was saved under — or null when the
 * user cancelled the save dialog, so callers can stay quiet instead of reporting a success.
 */
async function fetchExport(path: string, campaignId: number): Promise<string | null> {
  const res = await fetch(`${baseUrl}${path}`, { credentials: "include" });
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
  const filename = named?.[1] ?? `campaign-${campaignId}.xlsx`;
  const blob = await res.blob();

  const picker = savePicker();
  if (picker) {
    let handle: SaveHandle | null = null;
    try {
      handle = await picker({
        suggestedName: filename,
        types: [{ description: "Excel workbook", accept: { [XLSX_MIME]: [".xlsx"] } }],
      });
    } catch (err) {
      const name = (err as { name?: string }).name;
      // The user closed the dialog: not a failure, and nothing should be downloaded.
      if (name === "AbortError") return null;
      // The gesture that opened the dialog had expired by the time the file was ready: fall back to the
      // ordinary download rather than losing the file.
      if (name !== "SecurityError") throw err;
    }
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return handle.name;
    }
  }

  return saveThroughBrowser(blob, filename);
}

/**
 * Downloads one campaign's flagged .xlsx — every uploaded column, plus the return status, the
 * reason and the resend of each package — for a campaign of the caller's own company.
 */
export const downloadCampaignExport = (campaignId: number): Promise<string | null> =>
  fetchExport(`/campaigns/${campaignId}/export`, campaignId);

/** The same file for a campaign of ANY customer, for the platform super-admin's Customers screen. */
export const downloadCampaignExportForAdmin = (campaignId: number): Promise<string | null> =>
  fetchExport(`/admin/campaigns/${campaignId}/export`, campaignId);
