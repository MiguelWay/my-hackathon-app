import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import { SaveLocationHint } from "../components/SaveLocationHint";
import { ReturnCounters } from "../components/ReturnCounters";
import { ReturnPackageList } from "../components/ReturnPackageList";
import { useI18n } from "../i18n/I18nContext";
import { isClosed, localToday } from "../lib/campaignDates";

interface Customer {
  id: number;
  name: string;
}

interface CustomerCampaign {
  id: number;
  name: string;
  start_date: string | null;
  finish_date: string | null;
  /** Lines in the uploaded lists; a resend adds a package without a line. Only a super-admin's view. */
  total_rows?: number;
  package_count: number;
  return_count: number;
  resend_count: number;
}

export function CustomersPage() {
  // The admin controls render for a super-admin, and are hidden while a super-admin is in the
  // operator's view — which is what makes this screen look like what a `user` sees. One page, two
  // roles: the only difference is which controls render.
  const { user, isAdmin: isSuperAdmin } = useAuth();
  const { t } = useI18n();
  const canDeleteCustomers = isSuperAdmin && user?.customerId == null;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const wantedCustomer = searchParams.get("customer") ?? "";
  const [items, setItems] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The customer whose delete has been armed, so deleting is never one careless click.
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // The customer whose row is open. Its campaigns are all this row holds; accounts live on the
  // Users screen.
  const [openId, setOpenId] = useState<number | null>(null);
  const [campaigns, setCampaigns] = useState<CustomerCampaign[] | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  // The open row, which can be below the fold.
  const expandRef = useRef<HTMLTableRowElement | null>(null);
  // Which row's data is allowed to land: a quick click on another customer must not show stale rows.
  const openRef = useRef<number | null>(null);

  // The list comes from the endpoint that matches the role: an operator reads the returns directory,
  // which carries the names; a super-admin reads the admin one, which also carries the account counts.
  const load = useCallback(async () => {
    setItems(
      isSuperAdmin
        ? await api.get<Customer[]>("/admin/customers")
        : await api.get<Customer[]>("/returns/customers")
    );
  }, [isSuperAdmin]);

  useEffect(() => {
    load().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : t("customers.loadFailed"))
    );
  }, [load]);

  // A customer is created on its own, and you are taken straight to the campaign form with this customer
  // already chosen — so the first campaign and every later one are made in the same place, the same way.
  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await api.post<{ id: number; name: string }>("/admin/customers", { name });
      setName("");
      await load();
      navigate(`/campaigns?customer=${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("customers.createFailed"));
    }
  }

  /** Deletes a customer and, with it, every campaign and package it owns. */
  async function removeCustomer(customer: Customer) {
    setError(null);
    setNotice(null);
    try {
      await api.delete(`/admin/customers/${customer.id}`);
      setNotice(t("customers.deleted", { name: customer.name }));
      setConfirmDelete(null);
      if (openId === customer.id) {
        setOpenId(null);
        setCampaigns(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("customers.deleteFailed"));
    }
  }

  /** Opens one customer's row — its campaigns. */
  async function toggle(customerId: number) {
    if (openId === customerId) {
      openRef.current = null;
      setOpenId(null);
      setCampaigns(null);
      return;
    }
    openRef.current = customerId;
    setOpenId(customerId);
    setError(null);
    setNotice(null);
    setCampaigns(null);
    try {
      const loaded = await api.get<CustomerCampaign[]>(
        isSuperAdmin
          ? `/admin/customers/${customerId}/campaigns`
          : `/returns/customers/${customerId}/campaigns`
      );
      if (openRef.current !== customerId) return;
      setCampaigns(loaded);
    } catch (err) {
      if (openRef.current !== customerId) return;
      setError(err instanceof Error ? err.message : t("customers.loadCustomerFailed"));
    }
  }

  async function downloadCampaign(campaign: CustomerCampaign) {
    setError(null);
    setNotice(null);
    setExporting(campaign.id);
    try {
      const filename = await downloadExport(
        adminCampaignExportUrl(campaign.id),
        exportFileName(campaign.id, campaign.name)
      );
      setNotice(t("customers.downloaded", { name: campaign.name, filename }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("customers.exportFailed"));
    } finally {
      setExporting(null);
    }
  }

  /** Chrome and Edge: ask the super-admin where to put this customer's export. */
  async function saveCampaignAs(campaign: CustomerCampaign) {
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
      setError(err instanceof Error ? err.message : t("customers.saveDialogFailed"));
    } finally {
      setExporting(null);
    }
  }

  /** A plain left-click downloads through the app; the link itself stays for right-click → save as. */
  function onCampaignChoiceClick(e: ReactMouseEvent<HTMLAnchorElement>, campaign: CustomerCampaign) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    void downloadCampaign(campaign);
  }

  // Whatever just opened can be below the fold on a short window: bring it into view.
  useEffect(() => {
    if (openId === null) return;
    expandRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [openId]);

  // Arriving from a campaign's returns screen: open that customer's row straight away. Administrators
  // no longer expand customer rows, so this only applies to the operator.
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (isSuperAdmin || openedFromUrl.current || !wantedCustomer || items.length === 0) return;
    openedFromUrl.current = true;
    const id = Number(wantedCustomer);
    if (items.some((c) => c.id === id)) void toggle(id);
  }, [isSuperAdmin, wantedCustomer, items]);

  // An operator's list is split by date: a campaign whose finish date has passed is closed and moves
  // into an accordion directly under the open ones. An upcoming campaign is still open. The
  // administrator's list is deliberately left unsplit.
  const todayIso = localToday();
  const openCampaigns = (campaigns ?? []).filter((camp) => !isClosed(camp, todayIso));
  const closedCampaigns = (campaigns ?? []).filter((camp) => isClosed(camp, todayIso));

  /** One campaign's row: the same markup whoever is looking; only the grouping differs. */
  function campaignRow(camp: CustomerCampaign) {
    return (
      <li key={camp.id}>
        {/* The row itself is the way in, and it reads exactly like the campaign's own screen: its
            name and the same three counters, without the dates. */}
        <Link
          className="campaign-choice"
          to={`/campaigns/${camp.id}/returns`}
          aria-label={t("customers.ariaRecordReturns", { name: camp.name })}
        >
          <span className="campaign-name">{camp.name}</span>
          <ReturnCounters
            sent={camp.package_count}
            returns={camp.return_count}
            resends={camp.resend_count}
          />
        </Link>
        {/* An operator has no download accordion, so the way in is spelled out: the row is also a
            link, but a button is what it looks like. The administrator's view is unchanged. */}
        {!isSuperAdmin && (
          <Link
            className="button"
            to={`/campaigns/${camp.id}/returns`}
            aria-label={t("customers.ariaOpenReturns", { name: camp.name })}
          >
            {t("customers.recordReturns")}
          </Link>
        )}
        {/* The results file is part of the campaign, so its download lives inside the campaign. */}
        {isSuperAdmin && (
          <details className="section campaign-download">
            <summary>{t("customers.resultsFile")}</summary>
            <div className="btn-row">
              <a
                className="button secondary"
                aria-disabled={exporting !== null || camp.package_count === 0}
                href={adminCampaignExportUrl(camp.id)}
                download
                onClick={(e) => onCampaignChoiceClick(e, camp)}
              >
                {exporting === camp.id ? t("customers.preparing") : t("customers.download")}
              </a>
              {canChooseSaveLocation() && (
                <button
                  type="button"
                  className="secondary"
                  disabled={exporting !== null || camp.package_count === 0}
                  onClick={() => saveCampaignAs(camp)}
                >
                  {t("customers.saveAs")}
                </button>
              )}
            </div>
            <SaveLocationHint />
          </details>
        )}

        <ReturnPackageList campaignId={camp.id} showDownload={false} />
      </li>
    );
  }

  return (
    <div>
      <h1>{t("customers.title")}</h1>
      {!isSuperAdmin && <p className="muted">{t("customers.operatorHelp")}</p>}

      {isSuperAdmin && (
        <details className="card">
          <summary>{t("customers.newCustomer")}</summary>
          <form className="customer-row" onSubmit={create}>
            <label>
              {t("customers.name")}
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <button>{t("customers.create")}</button>
          </form>
        </details>
      )}

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      {items.length === 0 ? (
        <p className="muted">
          {t("customers.empty")}{" "}
          {isSuperAdmin && t("customers.emptyAdmin")}
        </p>
      ) : (
        <table className="grid customers-table">
          <thead>
            <tr>
              <th>{t("customers.id")}</th>
              <th>{t("customers.name")}</th>
              {canDeleteCustomers && <th></th>}
              {!isSuperAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const open = openId === c.id;
              return (
                <Fragment key={c.id}>
                  <tr
                    className={isSuperAdmin ? "" : `customer-head${open ? " open" : ""}`}
                    onClick={isSuperAdmin ? undefined : () => void toggle(c.id)}
                  >
                    <td>{c.id}</td>
                    <td>{c.name}</td>
                    {canDeleteCustomers && (
                      <td className="row-actions">
                        {confirmDelete === c.id ? (
                          <div className="btn-row">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void removeCustomer(c);
                              }}
                            >
                              {t("customers.confirmDelete")}
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDelete(null);
                              }}
                            >
                              {t("customers.cancel")}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDelete(c.id);
                            }}
                          >
                            {t("customers.delete")}
                          </button>
                        )}
                      </td>
                    )}
                    {!isSuperAdmin && (
                      <td className="disclosure-cell">
                        <button
                          type="button"
                          className="disclosure"
                          aria-expanded={open}
                          aria-controls={`customer-${c.id}-panel`}
                          aria-label={t(
                            open ? "customers.hideCampaigns" : "customers.showCampaigns",
                            { name: c.name }
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggle(c.id);
                          }}
                        >
                          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                        </button>
                      </td>
                    )}
                  </tr>

                  {!isSuperAdmin && open && (
                    <tr className="expand" id={`customer-${c.id}-panel`} ref={expandRef}>
                      <td colSpan={canDeleteCustomers ? 4 : 3}>
                        <section className="customer-group">
                          <h2 className="group-title">{t("customers.campaigns")}</h2>
                          {campaigns === null ? (
                            <p className="muted">{t("customers.loading")}</p>
                          ) : campaigns.length === 0 ? (
                            <p className="muted">
                              <strong>{c.name}</strong>
                              {t("customers.noCampaignsSuffix")}
                              {isSuperAdmin && ` ${t("customers.createFromCampaigns")}`}
                            </p>
                          ) : (
                            <>
                              <p className="muted">
                                <strong>{c.name}</strong>
                                {t(
                                  campaigns.length === 1
                                    ? "customers.campaignCountOne"
                                    : "customers.campaignCountOther",
                                  { count: campaigns.length }
                                )}
                              </p>
                              {isSuperAdmin ? (
                                <ul className="campaign-list">{campaigns.map(campaignRow)}</ul>
                              ) : (
                                <>
                                  {openCampaigns.length === 0 ? (
                                    <p className="muted">{t("customers.noOpenCampaigns")}</p>
                                  ) : (
                                    <ul className="campaign-list">
                                      {openCampaigns.map(campaignRow)}
                                    </ul>
                                  )}
                                  {closedCampaigns.length > 0 && (
                                    <details className="section campaign-archive">
                                      <summary>
                                        {t("customers.closedCampaigns", {
                                          count: closedCampaigns.length,
                                        })}
                                      </summary>
                                      <ul className="campaign-list">
                                        {closedCampaigns.map(campaignRow)}
                                      </ul>
                                    </details>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </section>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
