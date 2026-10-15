import { baseUrl } from "./api";

/** Fetches one campaign's .xlsx and hands it to the browser, returning the file name it was saved as. */
async function fetchExport(path: string, campaignId: number): Promise<string> {
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

  const url = URL.createObjectURL(await res.blob());
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
 * Downloads one campaign's flagged .xlsx — every uploaded column, plus the return status, the
 * reason and the resend of each package — for a campaign of the caller's own company.
 */
export const downloadCampaignExport = (campaignId: number): Promise<string> =>
  fetchExport(`/campaigns/${campaignId}/export`, campaignId);

/** The same file for a campaign of ANY customer, for the platform super-admin's Customers screen. */
export const downloadCampaignExportForAdmin = (campaignId: number): Promise<string> =>
  fetchExport(`/admin/campaigns/${campaignId}/export`, campaignId);
