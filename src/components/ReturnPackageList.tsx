import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { downloadExport, returnListExportUrl } from "../lib/campaignExport";

interface Row {
  sender_id: string;
  status: "Returned" | "Resent";
  reason_label: string | null;
}

/** One resend link: the package that came back, and the package it went out as next. */
interface Link {
  returned_id: string;
  reason: string | null;
  resent_id: string;
  returned_again_id: string | null;
  returned_again_reason: string | null;
}

/**
 * A campaign's return package list: every package that came back or was used as a resend, one row
 * each. A package that is both is shown once, as a return — red wins, the same rule as the export.
 *
 * Under it, the resend links: one row per return → resend pair, with the resent package's own return
 * beside it when it came back too. That table is deliberately uncoloured.
 *
 * The panel loads when it is shown. `refreshToken` makes it reload after a return or resend is saved
 * while it is open.
 */
export function ReturnPackageList({
  campaignId,
  refreshToken = 0,
}: {
  campaignId: number;
  refreshToken?: number;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    setLinks([]);
    setError(null);
    api
      .get<{ rows: Row[]; links: Link[] }>(`/returns/campaigns/${campaignId}/return-list`)
      .then((res) => {
        if (!live) return;
        setRows(res.rows);
        setLinks(res.links);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Could not load the list");
      });
    return () => {
      live = false;
    };
  }, [campaignId, refreshToken]);

  async function download() {
    setError(null);
    setNotice(null);
    setDownloading(true);
    try {
      const filename = await downloadExport(
        returnListExportUrl(campaignId),
        "return-package-list.xlsx"
      );
      setNotice(`Downloaded ${filename}, in your browser's download folder.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download the list");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="card return-list-panel">
      <h2>Return package list</h2>
      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows !== null && rows.length === 0 && (
        <p className="muted">Nothing has been returned or resent in this campaign yet.</p>
      )}
      {rows !== null && rows.length > 0 && (
        <>
          <div className="scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Package ID</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.sender_id}
                    className={row.status === "Returned" ? "row-returned" : "row-resent"}
                  >
                    <td>{row.sender_id}</td>
                    <td>{row.status}</td>
                    <td>{row.reason_label ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {links.length > 0 && (
            <>
              <h2>Resend links</h2>
              <div className="scroll">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Returned ID</th>
                      <th>Reason</th>
                      <th>Resent ID</th>
                      <th>Returned ID</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {links.map((link) => (
                      <tr key={link.resent_id}>
                        <td>{link.returned_id}</td>
                        <td>{link.reason ?? <span className="muted">—</span>}</td>
                        <td>{link.resent_id}</td>
                        <td>{link.returned_again_id ?? <span className="muted">—</span>}</td>
                        <td>{link.returned_again_reason ?? <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="btn-row">
            <button type="button" className="secondary" disabled={downloading} onClick={download}>
              {downloading ? "Preparing…" : "Download .xlsx"}
            </button>
          </div>
          <p className="muted">Both tables, one sheet each.</p>
          {notice && <p className="ok">{notice}</p>}
        </>
      )}
    </div>
  );
}
