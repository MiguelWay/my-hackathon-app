import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { ReturnCounters } from "../components/ReturnCounters";
import {
  CHAINS_EXPORT_FILENAME,
  campaignExportUrl,
  canChooseSaveLocation,
  chainsExportUrl,
  downloadExport,
  exportFileName,
  saveExportAs,
  saveNotice,
} from "../lib/campaignExport";
import { SaveLocationHint } from "../components/SaveLocationHint";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n/I18nContext";

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
  /** Every package the company has sent, resends included. */
  sent: number;
  /** Every return the company has, not just the ones the capped list shows. */
  returns: number;
  /** Every package created by a resend. */
  resends: number;
  /** How many returns the recent list can hold. */
  recent: number;
}

/** One chain of attempts: the package a store sent back, then each time it went out again. */
interface ChainRow {
  original_id: number;
  original_sender_id: string;
  campaign_name: string;
  /** Why the store sent the original back, or null when no reason was recorded. */
  reason_label: string | null;
  /** The sender IDs of the attempts after the original, in the order they were sent. */
  resends: string[];
}


/** Handed over by /returns after a resend is saved, so the operator sees it confirmed here. */
interface ResentNotice {
  original: string;
  replacement: string;
  campaignName: string;
}

/** The most recently recorded returns, newest first. */
export function RecentReturnsPage() {
  const { user, isAdmin: isSuperAdmin } = useAuth();
  const { t } = useI18n();
  const hasCompany = user?.customerId != null;
  const location = useLocation();
  const resent = (location.state as { resent?: ResentNotice } | null)?.resent;

  const [items, setItems] = useState<RecentReturnRow[]>([]);
  const [summary, setSummary] = useState<ReturnSummary | null>(null);
  const [chains, setChains] = useState<ChainRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Every campaign of the company can be exported, not just the ones with returns below.
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [exporting, setExporting] = useState(false);
  const [chainsExporting, setChainsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rows, totals, chained] = await Promise.all([
      api.get<RecentReturnRow[]>("/returns"),
      api.get<ReturnSummary>("/returns/summary"),
      api.get<ChainRow[]>("/returns/chains"),
    ]);
    setItems(rows);
    setSummary(totals);
    setChains(chained);
  }, []);

  useEffect(() => {
    if (!hasCompany) return;
    load()
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : t("recent.loadFailed"))
      )
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
        setError(e instanceof Error ? e.message : t("recent.campaignListFailed"))
      );
  }, [hasCompany, isSuperAdmin]);

  async function runExport() {
    const campaign = campaigns.find((c) => String(c.id) === selectedCampaign);
    if (!campaign) {
      setError(t("recent.pickCampaignDownload"));
      return;
    }
    setError(null);
    setExportNotice(null);
    setExporting(true);
    try {
      const filename = await downloadExport(
        campaignExportUrl(campaign.id),
        exportFileName(campaign.id, campaign.name)
      );
      setExportNotice(t("recent.downloaded", { name: campaign.name, filename }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("recent.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  /** Chrome and Edge: ask where to put the file, then write it there. */
  async function runSaveAs() {
    const campaign = campaigns.find((c) => String(c.id) === selectedCampaign);
    if (!campaign) {
      setError(t("recent.pickCampaignSave"));
      return;
    }
    setError(null);
    setExportNotice(null);
    setExporting(true);
    try {
      const result = await saveExportAs(
        campaignExportUrl(campaign.id),
        exportFileName(campaign.id, campaign.name)
      );
      setExportNotice(saveNotice(result));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("recent.saveDialogFailed"));
    } finally {
      setExporting(false);
    }
  }

  /** The chain report: one row per chain, the same rows the table above shows. */
  async function runChainsExport() {
    setError(null);
    setExportNotice(null);
    setChainsExporting(true);
    try {
      const filename = await downloadExport(chainsExportUrl(), CHAINS_EXPORT_FILENAME);
      setExportNotice(t("recent.chainDownloaded", { filename }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("recent.exportFailed"));
    } finally {
      setChainsExporting(false);
    }
  }

  async function runChainsSaveAs() {
    setError(null);
    setExportNotice(null);
    setChainsExporting(true);
    try {
      const result = await saveExportAs(chainsExportUrl(), CHAINS_EXPORT_FILENAME);
      setExportNotice(saveNotice(result));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("recent.saveDialogFailed"));
    } finally {
      setChainsExporting(false);
    }
  }

  if (!hasCompany) {
    return (
      <div>
        <h1>{t("recent.title")}</h1>
        <p className="muted">{t("recent.noCompany")}</p>
      </div>
    );
  }

  /** The heading for the nth resend column. The .xlsx export keeps its own English headings. */
  function resendHeader(i: number): string {
    return t(i <= 5 ? `recent.resend${i}` : "recent.resendN", { n: i });
  }

  // As many resend columns as the longest chain needs.
  const resendHeaders = Array.from(
    { length: chains.reduce((deepest, c) => Math.max(deepest, c.resends.length), 0) },
    (_, i) => resendHeader(i + 1)
  );

  return (
    <div>
      <h1>{t("recent.title")}</h1>
      <p className="muted">{t("recent.subtitle")}</p>

      {resent && (
        <p className="ok">
          {t("recent.linked", {
            replacement: resent.replacement,
            original: resent.original,
            campaign: resent.campaignName,
          })}
        </p>
      )}

      {error && <p className="error">{error}</p>}
      {exportNotice && <p className="ok">{exportNotice}</p>}

      {summary && (
        <>
          <ReturnCounters
            sent={summary.sent}
            returns={summary.returns}
            resends={summary.resends}
          />
          {summary.returns > summary.recent && (
            <p className="muted">
              {t("recent.latest", { count: summary.recent })}
            </p>
          )}
        </>
      )}

      {isSuperAdmin && campaigns.length > 0 && (
        <div className="card">
          <h2>{t("recent.downloadCampaign")}</h2>
          <p className="muted">{t("recent.downloadHelp")}</p>
          <div className="btn-row">
            <label>
              {t("recent.campaign")}
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
              {exporting ? t("recent.preparing") : t("recent.download")}
            </a>
            {canChooseSaveLocation() && (
              <button type="button" className="secondary" disabled={exporting} onClick={runSaveAs}>
                {t("recent.saveAs")}
              </button>
            )}
          </div>
          <SaveLocationHint />
        </div>
      )}

      {chains.length > 0 && (
        <div className="card">
          <h2>{t("recent.chains")}</h2>
          <p className="muted">{t("recent.chainsHelp")}</p>
          <div className="scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>{t("recent.originalId")}</th>
                  {resendHeaders.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                  <th>{t("recent.campaign")}</th>
                  <th>{t("recent.returnReason")}</th>
                </tr>
              </thead>
              <tbody>
                {chains.map((c) => (
                  <tr key={c.original_id}>
                    <td>{c.original_sender_id}</td>
                    {resendHeaders.map((_, i) => (
                      <td key={i}>
                        {c.resends[i] ?? <span className="muted">—</span>}
                      </td>
                    ))}
                    <td>{c.campaign_name}</td>
                    <td>
                      {c.reason_label ?? <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="btn-row">
            <a
              className={chainsExporting ? "button secondary disabled" : "button secondary"}
              href={chainsExportUrl()}
              download
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                void runChainsExport();
              }}
            >
              {chainsExporting ? t("recent.preparing") : t("recent.download")}
            </a>
            {canChooseSaveLocation() && (
              <button
                type="button"
                className="secondary"
                disabled={chainsExporting}
                onClick={runChainsSaveAs}
              >
                {t("recent.saveAs")}
              </button>
            )}
          </div>
          <SaveLocationHint />
        </div>
      )}

      {loading ? (
        <p className="muted">{t("recent.loading")}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t("recent.nothing")}</p>
      ) : (
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>{t("recent.packageId")}</th>
                <th>{t("recent.resentAs")}</th>
                <th>{t("recent.campaign")}</th>
                <th>{t("recent.reason")}</th>
                <th>{t("recent.when")}</th>
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
                    {r.closed_store === 1 && (
                      <span className="chip">{t("recent.closedStore")}</span>
                    )}
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
