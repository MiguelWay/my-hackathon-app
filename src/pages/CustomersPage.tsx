import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import { PasswordInput } from "../components/PasswordInput";

interface Customer {
  id: number;
  name: string;
  /** A super-admin sees how many accounts a customer has; the operator's directory does not carry it. */
  user_count?: number;
  active_user_count?: number;
}

interface CustomerUser {
  id: number;
  email: string;
  role: "superadmin" | "user";
  is_active: number;
  created_at: string;
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
}

interface NewUserForm {
  email: string;
  password: string;
  role: "superadmin" | "user";
}

const emptyForm = (): NewUserForm => ({ email: "", password: "", role: "superadmin" });

/** Today, as the date inputs and the API both want it. */
const today = () => new Date().toISOString().slice(0, 10);

export function CustomersPage() {
  // The admin controls render for a super-admin, and are hidden while a super-admin is in the user
  // view — which is what makes "Process returns" look like what a `user` sees. One page, two roles:
  // the only difference is which controls render.
  const { isAdmin: isSuperAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const wantedCustomer = searchParams.get("customer") ?? "";
  const [items, setItems] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [finishDate, setFinishDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The customer whose row is open, and the "add account" form's values.
  const [openId, setOpenId] = useState<number | null>(null);
  const [form, setForm] = useState<NewUserForm>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<CustomerUser[]>([]);
  // The account whose delete has been armed, so deleting is never one careless click.
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
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
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [load]);

  // A customer is never an empty shell: the first campaign is created with it, so it is ready to
  // receive a list the moment it exists. The name is the caller's to choose; the dates default to
  // today and can be corrected on the Campaigns screen.
  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await api.post<{ name: string; campaign: { name: string } }>(
        "/admin/customers",
        {
          name,
          campaignName: campaignName || undefined,
          startDate: startDate || null,
          finishDate: finishDate || null,
        }
      );
      setNotice(`Created ${created.name} with the campaign “${created.campaign.name}”.`);
      setName("");
      setCampaignName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    }
  }

  async function addUser(e: FormEvent) {
    e.preventDefault();
    if (openId === null) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const created = await api.post<CustomerUser>(`/admin/customers/${openId}/users`, {
        email: form.email,
        password: form.password,
        role: form.role,
      });
      setNotice(`Created ${created.role === "superadmin" ? "super-admin" : "user"} ${created.email}.`);
      setForm(emptyForm());
      // Keep the row open, so the account just added shows up in the list below it.
      await refreshUsers();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the account");
    } finally {
      setBusy(false);
    }
  }

  /** Reloads the accounts of the customer whose row is open. */
  async function refreshUsers() {
    if (openId === null) return;
    setUsers(await api.get<CustomerUser[]>(`/admin/customers/${openId}/users`));
  }

  async function setUserActive(user: CustomerUser, active: boolean) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.patch(`/admin/users/${user.id}`, { active });
      setNotice(`${active ? "Activated" : "Deactivated"} ${user.email}.`);
      setConfirmDelete(null);
      await refreshUsers();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change that account");
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(user: CustomerUser) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.delete(`/admin/users/${user.id}`);
      setNotice(`Deleted ${user.email}.`);
      setConfirmDelete(null);
      await refreshUsers();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that account");
    } finally {
      setBusy(false);
    }
  }

  /** Opens one customer's row — its campaigns, and for a super-admin its accounts as well. */
  async function toggle(customerId: number) {
    if (openId === customerId) {
      openRef.current = null;
      setOpenId(null);
      setUsers([]);
      setCampaigns(null);
      setForm(emptyForm());
      setConfirmDelete(null);
      return;
    }
    openRef.current = customerId;
    setOpenId(customerId);
    setForm(emptyForm());
    setError(null);
    setNotice(null);
    setConfirmDelete(null);
    setUsers([]);
    setCampaigns(null);
    try {
      const loaded = await api.get<CustomerCampaign[]>(
        isSuperAdmin
          ? `/admin/customers/${customerId}/campaigns`
          : `/returns/customers/${customerId}/campaigns`
      );
      const openUsers = isSuperAdmin
        ? await api.get<CustomerUser[]>(`/admin/customers/${customerId}/users`)
        : [];
      if (openRef.current !== customerId) return;
      setCampaigns(loaded);
      setUsers(openUsers);
    } catch (err) {
      if (openRef.current !== customerId) return;
      setError(err instanceof Error ? err.message : "Failed to load that customer's data");
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
      setNotice(`Downloaded ${campaign.name} as ${filename}, in your browser's download folder.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
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
      setError(err instanceof Error ? err.message : "Could not open a save dialog");
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

  const activeUsers = users.filter((u) => u.is_active === 1).length;

  // Whatever just opened can be below the fold on a short window: bring it into view.
  useEffect(() => {
    if (openId === null) return;
    expandRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [openId]);

  // Arriving from a campaign's returns screen: open that customer's row straight away.
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (openedFromUrl.current || !wantedCustomer || items.length === 0) return;
    openedFromUrl.current = true;
    const id = Number(wantedCustomer);
    if (items.some((c) => c.id === id)) void toggle(id);
  }, [wantedCustomer, items]);

  return (
    <div>
      <h1>Customers</h1>
      <p className="muted">
        {isSuperAdmin
          ? "Each customer is a separate company. Their data never mixes with another customer's. Open a row for its campaigns and its accounts."
          : "Pick a customer to see its campaigns, then a campaign to record its returns."}
      </p>

      {isSuperAdmin && (
        <details className="card">
          <summary>New customer</summary>
          <form className="customer-row" onSubmit={create}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              First campaign
              <input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Defaults to the customer's name"
              />
            </label>
            <label>
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label>
              Finish date
              <input
                type="date"
                value={finishDate}
                onChange={(e) => setFinishDate(e.target.value)}
              />
            </label>
            <button>Create</button>
          </form>
          <p className="muted">
            The first campaign is created with the customer, so it can take a list straight away. Its
            dates default to today and can be changed on the Campaigns screen.
          </p>
        </details>
      )}

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      {items.length === 0 ? (
        <p className="muted">
          No customers yet.{" "}
          {isSuperAdmin && "Create the first one above."}
        </p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              {isSuperAdmin && <th>Users</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const open = openId === c.id;
              return (
                <Fragment key={c.id}>
                  <tr
                    className={`customer-head${open ? " open" : ""}`}
                    onClick={() => void toggle(c.id)}
                  >
                    <td>{c.id}</td>
                    <td>{c.name}</td>
                    {isSuperAdmin && (
                      <td>
                        {c.user_count}
                        {c.active_user_count !== c.user_count && (
                          <span className="muted"> · {c.active_user_count} active</span>
                        )}
                      </td>
                    )}
                    <td className="disclosure-cell">
                      <button
                        type="button"
                        className="disclosure"
                        aria-expanded={open}
                        aria-controls={`customer-${c.id}-panel`}
                        aria-label={`${open ? "Hide" : "Show"} the campaigns of ${c.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggle(c.id);
                        }}
                      >
                        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                      </button>
                    </td>
                  </tr>

                  {open && (
                    <tr className="expand" id={`customer-${c.id}-panel`} ref={expandRef}>
                      <td colSpan={isSuperAdmin ? 4 : 3}>
                        <section className="customer-group">
                          <h2 className="group-title">Campaigns</h2>
                          {campaigns === null ? (
                            <p className="muted">Loading…</p>
                          ) : campaigns.length === 0 ? (
                            <p className="muted">
                              <strong>{c.name}</strong> has no campaigns yet.
                              {isSuperAdmin && " Create one from the Campaigns screen."}
                            </p>
                          ) : (
                            <>
                              <p className="muted">
                                <strong>{c.name}</strong> — {campaigns.length} campaign
                                {campaigns.length === 1 ? "" : "s"}.{" "}
                                {isSuperAdmin
                                  ? "Click one to record its returns and resends; download its flagged .xlsx from the control beside it."
                                  : "Click one to record its returns and resends."}
                              </p>
                              <ul className="campaign-list">
                                {campaigns.map((camp) => {
                                  // Where the campaign sits, and how it is doing.
                                  const details = (
                                    <>
                                      <span className="campaign-name">{camp.name}</span>
                                      <span className="muted">
                                        {camp.start_date ?? "—"} → {camp.finish_date ?? "—"}
                                      </span>
                                      <span className="muted">
                                        {camp.total_rows !== undefined && (
                                          <>{camp.total_rows} lines · </>
                                        )}
                                        {camp.package_count} packages · {camp.return_count} return
                                        {camp.return_count === 1 ? "" : "s"}
                                      </span>
                                    </>
                                  );
                                  return (
                                    <li key={camp.id}>
                                      <Link
                                        className="campaign-choice"
                                        to={`/campaigns/${camp.id}/returns`}
                                      >
                                        {details}
                                        <span className="download">Record returns →</span>
                                      </Link>
                                      {isSuperAdmin && (
                                        <>
                                          <a
                                            className="button secondary"
                                            aria-disabled={
                                              exporting !== null || camp.package_count === 0
                                            }
                                            href={adminCampaignExportUrl(camp.id)}
                                            download
                                            onClick={(e) => onCampaignChoiceClick(e, camp)}
                                          >
                                            {exporting === camp.id ? "Preparing…" : "Download .xlsx"}
                                          </a>
                                          {canChooseSaveLocation() && (
                                            <button
                                              type="button"
                                              className="secondary"
                                              disabled={exporting !== null || camp.package_count === 0}
                                              onClick={() => saveCampaignAs(camp)}
                                            >
                                              Save as…
                                            </button>
                                          )}
                                        </>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                              {isSuperAdmin && <SaveLocationHint />}
                            </>
                          )}
                        </section>

                        {isSuperAdmin && (
                          <section className="customer-group">
                            <h2 className="group-title">Accounts</h2>

                            <details className="section">
                              <summary>New user</summary>

                              <form className="customer-row" onSubmit={addUser}>
                                <label>
                                  Email
                                  <input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    placeholder="them@example.com"
                                    required
                                  />
                                </label>
                                <label>
                                  Password
                                  <PasswordInput
                                    value={form.password}
                                    onChange={(password) => setForm({ ...form, password })}
                                    minLength={8}
                                    autoComplete="new-password"
                                  />
                                </label>
                                <label>
                                  Role
                                  <select
                                    value={form.role}
                                    onChange={(e) =>
                                      setForm({
                                        ...form,
                                        role: e.target.value as "superadmin" | "user",
                                      })
                                    }
                                  >
                                    <option value="superadmin">
                                      super-admin — runs campaigns &amp; accounts
                                    </option>
                                    <option value="user">user — processes returns</option>
                                  </select>
                                </label>
                                <button disabled={busy}>{busy ? "…" : "Add user"}</button>
                              </form>
                              <p className="muted">
                                Passwords must be 8–100 characters. Emails are unique across the whole
                                platform, and a new account can log in straight away.
                              </p>
                            </details>

                            <details className="section" open>
                              <summary>Current users</summary>

                              {users.length === 0 ? (
                                <p className="muted">No users yet.</p>
                              ) : (
                                <>
                                  <table className="grid">
                                    <thead>
                                      <tr>
                                        <th>Email</th>
                                        <th>Role</th>
                                        <th>Status</th>
                                        <th>Added</th>
                                        <th></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {users.map((u) => (
                                        <tr key={u.id}>
                                          <td>{u.email}</td>
                                          <td>
                                            <span className={`badge role-${u.role}`}>{u.role}</span>
                                          </td>
                                          <td>
                                            {u.is_active === 1 ? (
                                              "active"
                                            ) : (
                                              <span className="chip">disabled</span>
                                            )}
                                          </td>
                                          <td className="muted">{u.created_at.slice(0, 10)}</td>
                                          <td>
                                            <div className="btn-row">
                                              <button
                                                type="button"
                                                className="secondary"
                                                disabled={busy}
                                                onClick={() =>
                                                  setUserActive(u, u.is_active !== 1)
                                                }
                                              >
                                                {u.is_active === 1 ? "Deactivate" : "Activate"}
                                              </button>
                                              {confirmDelete === u.id ? (
                                                <>
                                                  <button
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() => deleteUser(u)}
                                                  >
                                                    Confirm delete
                                                  </button>
                                                  <button
                                                    type="button"
                                                    className="secondary"
                                                    disabled={busy}
                                                    onClick={() => setConfirmDelete(null)}
                                                  >
                                                    Cancel
                                                  </button>
                                                </>
                                              ) : (
                                                <button
                                                  type="button"
                                                  className="secondary"
                                                  disabled={busy}
                                                  onClick={() => setConfirmDelete(u.id)}
                                                >
                                                  Delete
                                                </button>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <p className="muted">
                                    {activeUsers} active · {users.length - activeUsers} disabled. A
                                    disabled user cannot log in and its open sessions end at once. A
                                    user that recorded returns can only be disabled, never deleted.
                                  </p>
                                </>
                              )}
                            </details>
                          </section>
                        )}
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
