import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { downloadCampaignExport } from "../lib/campaignExport";
import { useAuth } from "../auth/AuthContext";

interface RecentReturnRow {
  id: number;
  returned_at: string;
  note: string | null;
  sender_id: string;
  campaign_id: number;
  campaign_name: string;
  reason_code: string;
  reason_label: string;
  closed_store: number;
  /** The package ID this one was sent again as, or null when it has not been resent. */
  resent_as: string | null;
}

/** Handed over by /returns after a resend is saved, so the operator sees it confirmed here. */
interface ResentNotice {
  original: string;
  replacement: string;
  campaignName: string;
}

/** The most recently recorded returns, newest first. */
export function RecentReturnsPage() {
  const { user } = useAuth();
  const hasCompany = user?.customerId != null;
  const isSuperAdmin = user?.role === "superadmin";
  const location = useLocation();
  const resent = (location.state as { resent?: ResentNotice } | null)?.resent;

  const [items, setItems] = useState<RecentReturnRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The campaign id being prepared, so only one export runs at a time.
  const [exporting, setExporting] = useState<number | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(await api.get<RecentReturnRow[]>("/returns"));
  }, []);

  useEffect(() => {
    if (!hasCompany) return;
    load()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [hasCompany, load]);

  // The campaigns these returns belong to, in the order they appear, each exportable on its own.
  const campaigns = useMemo(() => {
    const byId = new Map<number, string>();
    for (const r of items) byId.set(r.campaign_id, r.campaign_name);
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [items]);

  async function runExport(campaignId: number, campaignName: string) {
    setError(null);
    setExportNotice(null);
    setExporting(campaignId);
    try {
      const filename = await downloadCampaignExport(campaignId);
      setExportNotice(`Downloaded ${campaignName} as ${filename}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }

  if (!hasCompany) {
    return (
      <div>
        <h1>Recently recorded</h1>
        <p className="muted">
          This account is not attached to a company, so it has no returns to show.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Recently recorded</h1>
      <p className="muted">
        Your company&rsquo;s most recent returns, newest first. <Link to="/returns">Packages returns</Link>
      </p>

      {resent && (
        <p className="ok">
          Linked {resent.replacement} as a resend of {resent.original} in &ldquo;{resent.campaignName}
          &rdquo;.
        </p>
      )}

      {error && <p className="error">{error}</p>}
      {exportNotice && <p className="ok">{exportNotice}</p>}

      {isSuperAdmin && campaigns.length > 0 && (
        <div className="card">
          <h2>Download a campaign</h2>
          <p className="muted">
            The flagged .xlsx: every uploaded column, plus the return status, the reason and the
            resend of each package.
          </p>
          <div className="btn-row">
            {campaigns.map((c) => (
              <button
                key={c.id}
                type="button"
                className="secondary"
                disabled={exporting !== null}
                onClick={() => runExport(c.id, c.name)}
              >
                {exporting === c.id ? "Preparing…" : `Download ${c.name}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">Nothing recorded yet.</p>
      ) : (
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Package ID</th>
                <th>Resent as</th>
                <th>Campaign</th>
                <th>Reason</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>{r.sender_id}</td>
                  <td>
                    {r.resent_as ? (
                      r.resent_as
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <Link to={`/campaigns/${r.campaign_id}`}>{r.campaign_name}</Link>
                  </td>
                  <td>
                    {r.reason_label}
                    {r.closed_store === 1 && <span className="chip">closed store</span>}
                    {r.note ? <span className="muted"> · {r.note}</span> : null}
                  </td>
                  <td>{r.returned_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
