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

async function fetchExport(url: string, campaignIdHint: number): Promise<{ blob: Blob; filename: string }> {
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
    filename: named?.[1] ?? `campaign-${campaignIdHint}.xlsx`,
  };
}

/**
 * Downloads the export into the browser's download folder and returns the file name. This never opens a
 * dialog, so it works everywhere — including browsers (and automated windows) where a save dialog cannot
 * be shown.
 */
export async function downloadExport(url: string, campaignIdHint = 0): Promise<string> {
  const { blob, filename } = await fetchExport(url, campaignIdHint);
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

/**
 * Asks the browser's save dialog where to put the export, then writes it there. Returns the chosen name,
 * or null when the user closed the dialog. Throws when the browser has no save dialog — callers should
 * only offer this where `canChooseSaveLocation()` is true.
 */
export async function saveExportAs(
  url: string,
  suggestedName: string,
  campaignIdHint = 0
): Promise<string | null> {
  const picker = savePicker();
  if (!picker) throw new Error("this browser cannot open a save dialog");

  // Asked first, while the click that started this is still fresh: the request can take a moment, and a
  // dialog opened too late is refused.
  let handle: SaveHandle;
  try {
    handle = await picker({
      suggestedName,
      types: [{ description: "Excel workbook", accept: { [XLSX_MIME]: [".xlsx"] } }],
    });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") return null;
    throw err;
  }

  const { blob } = await fetchExport(url, campaignIdHint);
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return handle.name;
}
