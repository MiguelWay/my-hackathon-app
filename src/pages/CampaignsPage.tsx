import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import {
  adminCampaignExportUrl,
  canChooseSaveLocation,
  downloadExport,
  exportFileName,
  saveExportAs,
  saveNotice,
} from "../lib/campaignExport";
import { CampaignListUpload } from "../components/CampaignListUpload";
import { SaveLocationHint } from "../components/SaveLocationHint";
import { ReturnCounters } from "../components/ReturnCounters";
import { ReturnPackageList } from "../components/ReturnPackageList";

interface Campaign {
  id: number;
  name: string;
  start_date: string | null;
  finish_date: string | null;
  upload_count: number;
  total_rows: number;
  package_count: number;
  return_count: number;
  resend_count: number;
  /** Which company the campaign belongs to. */
  customer_id?: number;
  customer_name?: string;
}

interface Upload {
  id: number;
  campaign_id: number;
  filename: string | null;
  row_count: number;
  created_at: string;
}

interface CustomerRef {
  id: number;
  name: string;
}

export function CampaignsPage() {
  const { user, isAdmin: isSuperAdmin } = useAuth();
  // A super-admin runs the campaigns; a `user` only processes returns. While a super-admin is in the
  // user view the admin controls are hidden, so this page behaves as it does for a `user`.
  // A platform super-admin has no company of its own, so it has to say whose campaign this is; every
  // other super-admin can only ever write into its own company, so its selector is fixed.
  const picksCompany = isSuperAdmin && user?.customerId == null;

  // A customer just created lands here as ?customer=<id>, so its first campaign can be made with the
  // company already chosen in the selector below — and with the form already open, since making a
  // campaign is the whole reason for arriving here.
  const [searchParams] = useSearchParams();
  const wantedCustomer = searchParams.get("customer") ?? "";
  const [newCampaignOpen, setNewCampaignOpen] = useState(wantedCustomer !== "");

  const [items, setItems] = useState<Campaign[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [customers, setCustomers] = useState<CustomerRef[]>([]);
  const [customerId, setCustomerId] = useState("");
  // Which campaign's list-upload is open. A plain toggle, not an accordion: the form appears in the
  // card itself rather than hidden behind a disclosure header.
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [finishDate, setFinishDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Which campaign's results file is being prepared, so only its own accordion says "Preparing…".
  const [exporting, setExporting] = useState<number | null>(null);

  // Every campaign, with the company it belongs to. A platform super-admin runs every customer's
  // campaigns from one list; a company super-admin stays on its own scoped routes.
  const load = useCallback(async () => {
    if (!picksCompany) {
      const [campaigns, lists] = await Promise.all([
        api.get<Campaign[]>("/campaigns"),
        api.get<Upload[]>("/campaigns/uploads"),
      ]);
      setItems(campaigns);
      setUploads(lists);
      return;
    }
    const [campaigns, lists] = await Promise.all([
      api.get<Campaign[]>("/admin/campaigns"),
      api.get<Upload[]>("/admin/campaigns/uploads"),
    ]);
    setItems(campaigns);
    setUploads(lists);
  }, [picksCompany]);

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [load]);

  // The company selector's options. A company super-admin can read the same admin list, so the one
  // company it is allowed to use is always available to name.
  useEffect(() => {
    if (!isSuperAdmin) return;
    api
      .get<CustomerRef[]>("/admin/customers")
      .then((list) => {
        setCustomers(list);
        // Arriving from "New customer": that customer is the one you came here to make a campaign for.
        if (wantedCustomer && list.some((c) => String(c.id) === wantedCustomer)) {
          setCustomerId(wantedCustomer);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load customers"));
  }, [isSuperAdmin, wantedCustomer]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/campaigns", {
        name,
        startDate: startDate || null,
        finishDate: finishDate || null,
        // Only a platform super-admin names the company; anyone else must leave it out, so a campaign
        // can never be planted in a company the caller does not belong to.
        ...(picksCompany ? { customerId: Number(customerId) } : {}),
      });
      setName("");
      setStartDate("");
      setFinishDate("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    }
  }

  /** Downloads one campaign's results file the ordinary way, into the browser's download folder. */
  async function downloadCampaign(campaign: Campaign) {
    setError(null);
    setNotice(null);
    setExporting(campaign.id);
    try {
      const filename = await downloadExport(
        adminCampaignExportUrl(campaign.id),
        exportFileName(campaign.id, campaign.name)
      );
      setNotice(`Downloaded ${campaign.name} as ${filename}, in your browser's download folder.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }

  /** Chrome and Edge: ask where to put this campaign's results file. */
  async function saveCampaignAs(campaign: Campaign) {
    setError(null);
    setNotice(null);
    setExporting(campaign.id);
    try {
      const result = await saveExportAs(
        adminCampaignExportUrl(campaign.id),
        exportFileName(campaign.id, campaign.name)
      );
      setNotice(saveNotice(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open a save dialog");
    } finally {
      setExporting(null);
    }
  }

  /** A plain left-click downloads through the app; the link itself stays for right-click → save as. */
  function onExportClick(e: ReactMouseEvent<HTMLAnchorElement>, campaign: Campaign) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    void downloadCampaign(campaign);
  }

  /** After an import: refresh the counts and the uploaded lists. */
  const listsByCampaign = useMemo(() => {
    const map = new Map<number, Upload[]>();
    for (const u of uploads) {
      const list = map.get(u.campaign_id);
      if (list) list.push(u);
      else map.set(u.campaign_id, [u]);
    }
    return map;
  }, [uploads]);

  const ownCompany = customers.find((c) => c.id === user?.customerId);

  // Every campaign, whichever company it belongs to. The Company selector inside *New campaign* is the
  // only place a company is named, and it decides who the campaign is created for — not what is listed.
  const visible = items;

  const emptyMessage = "No campaigns yet.";

  return (
    <div>
      <h1>Campaigns</h1>

      {!isSuperAdmin && (
        <p className="muted">Only a super-admin can create campaigns and upload lists.</p>
      )}

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      {isSuperAdmin && (
        <details
          className="card"
          open={newCampaignOpen}
          onToggle={(e) => setNewCampaignOpen(e.currentTarget.open)}
        >
          <summary>New campaign</summary>
          <form className="customer-row" onSubmit={create}>
            <label>
              Company
              <select
                value={picksCompany ? customerId : String(user?.customerId ?? "")}
                disabled={!picksCompany}
                required={picksCompany}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                {picksCompany ? (
                  <>
                    <option value="">Choose a company…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </>
                ) : (
                  <option value={String(user?.customerId ?? "")}>
                    {ownCompany?.name ?? "Your company"}
                  </option>
                )}
              </select>
            </label>
            <label>
              Campaign name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </label>
            <label>
              Finish date
              <input
                type="date"
                value={finishDate}
                onChange={(e) => setFinishDate(e.target.value)}
                required
              />
            </label>
            <button>Create</button>
          </form>
          <p className="muted">
            {picksCompany
              ? "The campaign is created for the company you pick. "
              : `This campaign will belong to ${ownCompany?.name ?? "your company"}. `}
            Start and finish dates are required: a campaign without a window cannot be reported on.
          </p>
        </details>
      )}

      <details className="card" open>
        <summary>{picksCompany ? "All campaigns" : "Campaigns"}</summary>

        {visible.length === 0 ? (
          <p className="muted">{emptyMessage}</p>
        ) : (
          visible.map((c) => {
            const lists = listsByCampaign.get(c.id) ?? [];
            return (
              <section className="campaign-block" key={c.id}>
                <div className="campaign-head">
                  {/* Plain text, not a hot link. */}
                  <span className="campaign-name">{c.name}</span>
                  {c.customer_name && <span className="badge">{c.customer_name}</span>}
                  <span className="muted">
                    {c.start_date ?? "—"} → {c.finish_date ?? "—"}
                  </span>
                  <span className="muted">
                    {c.upload_count} list{c.upload_count === 1 ? "" : "s"} · {c.total_rows} line
                    {c.total_rows === 1 ? "" : "s"}
                  </span>
                </div>

                {/* The same three counters, in the same format, as the campaign's own screen. */}
                <ReturnCounters
                  sent={c.package_count}
                  returns={c.return_count}
                  resends={c.resend_count}
                />

                {lists.length === 0 ? (
                  <p className="muted">No lists uploaded yet.</p>
                ) : (
                  <ul className="upload-list">
                    {lists.map((u) => (
                      <li key={u.id}>
                        <span className="file">{u.filename ?? "unknown file"}</span>
                        <span>{u.row_count} lines</span>
                        <span className="muted">uploaded {u.created_at}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* A button, not an accordion: the upload opens in the card itself. */}
                {isSuperAdmin && (
                  <div className="btn-row">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setUploadingFor(uploadingFor === c.id ? null : c.id)}
                    >
                      {uploadingFor === c.id ? "Close" : "Add a list"}
                    </button>
                  </div>
                )}

                {uploadingFor === c.id && (
                  <div className="upload-inline">
                    <CampaignListUpload campaignId={c.id} onImported={load} />
                  </div>
                )}

                <ReturnPackageList campaignId={c.id} />

                {/* The campaign's own results file, as an accordion inside the campaign: the download
                    belongs to the campaign rather than sitting beside it. */}
                {isSuperAdmin && (
                  <details className="section campaign-download">
                    <summary>Results file download</summary>
                    <div className="btn-row">
                      <a
                        className="button secondary"
                        aria-disabled={exporting !== null || c.package_count === 0}
                        href={adminCampaignExportUrl(c.id)}
                        download
                        onClick={(e) => onExportClick(e, c)}
                      >
                        {exporting === c.id ? "Preparing…" : "Download .xlsx"}
                      </a>
                      {canChooseSaveLocation() && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={exporting !== null || c.package_count === 0}
                          onClick={() => void saveCampaignAs(c)}
                        >
                          Save as…
                        </button>
                      )}
                    </div>
                    <SaveLocationHint />
                  </details>
                )}
              </section>
            );
          })
        )}
      </details>
    </div>
  );
}
