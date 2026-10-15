import { baseUrl } from "./api";

/**
 * Downloads one campaign's flagged .xlsx — every uploaded column, plus the return status, the
 * reason and the resend of each package — and returns the file name the server chose.
 */
export async function downloadCampaignExport(campaignId: number): Promise<string> {
  const res = await fetch(`${baseUrl}/campaigns/${campaignId}/export`, { credentials: "include" });
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
