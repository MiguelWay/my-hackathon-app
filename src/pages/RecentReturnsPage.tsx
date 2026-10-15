import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { campaignExportUrl, canChooseSaveLocation, downloadExport, exportFileName, saveExportAs, saveNotice } from "../lib/campaignExport";
import { SaveLocationHint } from "../components/SaveLocationHint";
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

interface CampaignOption {
  id: number;
  name: string;
}

interface ReturnSummary {
  /** Every return the company has, not just the ones the capped list shows. */
  returns: number;
  /** Every package created by a resend. */
  resends: number;
  /** How many returns the recent list can hold. */
  recent: number;
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
  const [summary, setSummary] = useState<ReturnSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Every campaign of the company can be exported, not just the ones with returns below.
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rows, totals] = await Promise.all([
      api.get<RecentReturnRow[]>("/returns"),
      api.get<ReturnSummary>("/returns/summary"),
    ]);
    setItems(rows);
    setSummary(totals);
  }, []);

  useEffect(() => {
    if (!hasCompany) return;
    load()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [hasCompany, load]);

  useEffect(() => {
    if (!hasCompany || !isSuperAdmin) return;
    api
      .get<CampaignOption[]>("/campaigns")
      .then((list) => {
        setCampaigns(list);
        setSelectedCampaign(list.length ? String(list[0].id) : "");
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load the campaign list")
      );
  }, [hasCompany, isSuperAdmin]);

  async function runExport() {
    const campaign = campaigns.find((c) => String(c.id) === selectedCampaign);
    if (!campaign) {
      setError("Pick a campaign to download.");
      return;
    }
    setError(null);
    setExportNotice(null);
    setExporting(true);
    try {
      const filename = await downloadExport(campaignExportUrl(campaign.id), campaign.id);
      setExportNotice(
        `Downloaded ${campaign.name} as ${filename}, in your browser's download folder.`
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  /** Chrome and Edge: ask where to put the file, then write it there. */
  async function runSaveAs() {
    const campaign = campaigns.find((c) => String(c.id) === selectedCampaign);
    if (!campaign) {
      setError("Pick a campaign to save.");
      return;
    }
    setError(null);
    setExportNotice(null);
    setExporting(true);
    try {
      const result = await saveExportAs(
        campaignExportUrl(campaign.id),
        exportFileName(campaign.id, campaign.name),
        campaign.id
      );
      setExportNotice(saveNotice(result));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not open a save dialog");
    } finally {
      setExporting(false);
    }
  }

  if (!hasCompany) {
    return (
      <div>
        <h1>Return packages</h1>
        <p className="muted">
          This account is not attached to a company, so it has no returns to show.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Return packages</h1>
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

      {summary && (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat-number">{summary.returns}</span>
              <span className="muted">
                returned package{summary.returns === 1 ? "" : "s"}
              </span>
            </div>
            <div className="stat">
              <span className="stat-number">{summary.resends}</span>
              <span className="muted">resend{summary.resends === 1 ? "" : "s"}</span>
            </div>
          </div>
          {summary.returns > summary.recent && (
            <p className="muted">The list below shows the latest {summary.recent}.</p>
          )}
        </>
      )}

      {isSuperAdmin && campaigns.length > 0 && (
        <div className="card">
          <h2>Download a campaign</h2>
          <p className="muted">
            The flagged .xlsx: every uploaded column, plus the return status, the reason and the
            resend of each package. Any of your company&rsquo;s campaigns can be downloaded.
          </p>
          <div className="btn-row">
            <label>
              Campaign
              <select
                value={selectedCampaign}
                onChange={(e) => setSelectedCampaign(e.target.value)}
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <a
              className={exporting ? "button secondary disabled" : "button secondary"}
              href={selectedCampaign ? campaignExportUrl(Number(selectedCampaign)) : "#"}
              download
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                void runExport();
              }}
            >
              {exporting ? "Preparing…" : "Download .xlsx"}
            </a>
            {canChooseSaveLocation() && (
              <button type="button" className="secondary" disabled={exporting} onClick={runSaveAs}>
                Save as…
              </button>
            )}
          </div>
          <SaveLocationHint />
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
