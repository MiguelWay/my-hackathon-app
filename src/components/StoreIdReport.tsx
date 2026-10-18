import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { downloadExport, storeReportExportUrl } from "../lib/campaignExport";

/** One return → resend link, with the store behind each package in the pair. */
interface Row {
  returned_store_id: string;
  returned_id: string;
  reason: string | null;
  resend_store_id: string;
  resend_id: string;
}

/**
 * The separate "Returns + Store ID" report, as a collapsed accordion.
 *
 * It is deliberately its own report and its own download: the Return package list above keeps the
 * two reports it already had, unchanged. One row per return → resend link; the left pair belongs to
 * the package that came back, the right pair to the package it went out as next.
 *
 * Fetched the first time it is opened and refreshed on every later open, or when `refreshToken`
 * changes while it is open, so a closed accordion costs nothing.
 */
export function StoreIdReport({
  campaignId,
  refreshToken = 0,
}: {
  campaignId: number;
  refreshToken?: number;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const loading = useRef(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    setRows(null);
    setError(null);
    try {
      const res = await api.get<{ rows: Row[] }>(`/returns/campaigns/${campaignId}/store-report`);
      setRows(res.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the report");
    } finally {
      loading.current = false;
    }
  }, [campaignId]);

  // Reload when a return or resend is saved while the accordion is open.
  useEffect(() => {
    if (detailsRef.current?.open) void load();
  }, [refreshToken, load]);

  async function download() {
    setError(null);
    setNotice(null);
    setDownloading(true);
    try {
      const filename = await downloadExport(
        storeReportExportUrl(campaignId),
        "returns-store-id.xlsx"
      );
      setNotice(`Downloaded ${filename}, in your browser's download folder.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download the report");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <details
      ref={detailsRef}
      className="card return-list-panel"
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary>Returns + Store ID</summary>

      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows !== null && rows.length === 0 && (
        <p className="muted">No return has been sent again in this campaign yet.</p>
      )}
      {rows !== null && rows.length > 0 && (
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Store ID</th>
                <th>Return package ID</th>
                <th>Reason</th>
                <th>Store ID</th>
                <th>Resend package ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.resend_id}>
                  <td>{row.returned_store_id}</td>
                  <td>{row.returned_id}</td>
                  <td>{row.reason ?? <span className="muted">—</span>}</td>
                  <td>{row.resend_store_id}</td>
                  <td>{row.resend_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows !== null && (
        <>
          <div className="btn-row">
            <button type="button" className="secondary" disabled={downloading} onClick={download}>
              {downloading ? "Preparing…" : "Download .xlsx"}
            </button>
          </div>
          <p className="muted">One row per return and the resend that followed it.</p>
          {notice && <p className="ok">{notice}</p>}
        </>
      )}
    </details>
  );
}
