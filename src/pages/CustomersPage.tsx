import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { downloadCampaignExportForAdmin } from "../lib/campaignExport";
import { PasswordInput } from "../components/PasswordInput";

interface Customer {
  id: number;
  name: string;
  created_at: string;
  user_count: number;
  active_user_count: number;
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
  package_count: number;
  return_count: number;
}

interface NewUserForm {
  email: string;
  password: string;
  role: "superadmin" | "user";
}

const emptyForm = (): NewUserForm => ({ email: "", password: "", role: "superadmin" });

/** A customer's panel below the table: their accounts, or their campaigns. */
type PanelKind = "users" | "campaigns";

export function CustomersPage() {
  const [items, setItems] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Which customer's panel is open, and the "add account" form's values.
  const [panel, setPanel] = useState<{ customerId: number; kind: PanelKind } | null>(null);
  const [form, setForm] = useState<NewUserForm>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<CustomerUser[]>([]);
  // The account whose delete has been armed, so deleting is never one careless click.
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [campaigns, setCampaigns] = useState<CustomerCampaign[] | null>(null);
  // The campaign clicked in the expanded list, so the operator can see which one they took.
  const [chosenCampaign, setChosenCampaign] = useState<number | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setItems(await api.get<Customer[]>("/admin/customers"));
  }, []);

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api.post("/admin/customers", { name });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    }
  }

  async function addUser(e: FormEvent) {
    e.preventDefault();
    if (panel?.kind !== "users") return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const created = await api.post<CustomerUser>(`/admin/customers/${panel.customerId}/users`, {
        email: form.email,
        password: form.password,
        role: form.role,
      });
      setNotice(`Created ${created.role === "superadmin" ? "super-admin" : "user"} ${created.email}.`);
      setForm(emptyForm());
      // Keep the panel open, so the account just added shows up in the list below it.
      await refreshUsers();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the account");
    } finally {
      setBusy(false);
    }
  }

  /** Reloads the accounts of the customer whose panel is open. */
  async function refreshUsers() {
    if (panel?.kind !== "users") return;
    setUsers(await api.get<CustomerUser[]>(`/admin/customers/${panel.customerId}/users`));
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

  async function togglePanel(customerId: number, kind: PanelKind) {
    if (panel?.customerId === customerId && panel.kind === kind) {
      setPanel(null);
      setUsers([]);
      setCampaigns(null);
      setForm(emptyForm());
      return;
    }
    setPanel({ customerId, kind });
    setForm(emptyForm());
    setError(null);
    setNotice(null);
    setUsers([]);
    setCampaigns(null);
    setChosenCampaign(null);
    try {
      if (kind === "users") {
        setUsers(await api.get<CustomerUser[]>(`/admin/customers/${customerId}/users`));
      } else {
        setCampaigns(await api.get<CustomerCampaign[]>(`/admin/customers/${customerId}/campaigns`));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load that customer's data");
    }
  }

  async function downloadCampaign(campaign: CustomerCampaign) {
    setError(null);
    setNotice(null);
    setChosenCampaign(campaign.id);
    setExporting(campaign.id);
    try {
      const filename = await downloadCampaignExportForAdmin(campaign.id);
      setNotice(`Downloaded ${campaign.name} as ${filename}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }

  const openCustomer = items.find((c) => c.id === panel?.customerId);
  const activeUsers = users.filter((u) => u.is_active === 1).length;

  return (
    <div>
      <h1>Customers</h1>
      <p className="muted">
        Each customer is a separate company. Their data never mixes with another customer&rsquo;s.
      </p>

      <form className="card inline" onSubmit={create}>
        <h2>New customer</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button>Create</button>
      </form>

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      {items.length === 0 ? (
        <p className="muted">No customers yet. Create the first one above.</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Users</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <Fragment key={c.id}>
                <tr>
                  <td>{c.id}</td>
                  <td>{c.name}</td>
                  <td>
                    {c.user_count}
                    {c.active_user_count !== c.user_count && (
                      <span className="muted"> · {c.active_user_count} active</span>
                    )}
                  </td>
                  <td>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => togglePanel(c.id, "users")}
                      >
                        {panel?.customerId === c.id && panel.kind === "users" ? "Close" : "Users"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => togglePanel(c.id, "campaigns")}
                      >
                        {panel?.customerId === c.id && panel.kind === "campaigns"
                          ? "Close"
                          : "Campaigns"}
                      </button>
                    </div>
                  </td>
                </tr>

                {panel?.customerId === c.id && panel.kind === "campaigns" && (
                  <tr className="expand">
                    <td colSpan={4}>
                      {campaigns === null ? (
                        <p className="muted">Loading…</p>
                      ) : campaigns.length === 0 ? (
                        <p className="muted">This customer has no campaigns yet.</p>
                      ) : (
                        <>
                          <p className="muted">
                            Click a campaign to download its flagged .xlsx: the uploaded columns plus
                            the return status, the reason and the resend of each package.
                          </p>
                          <ul className="campaign-list">
                            {campaigns.map((camp) => (
                              <li key={camp.id}>
                                <button
                                  type="button"
                                  className={
                                    chosenCampaign === camp.id
                                      ? "campaign-choice now"
                                      : "campaign-choice"
                                  }
                                  aria-pressed={chosenCampaign === camp.id}
                                  disabled={exporting !== null || camp.package_count === 0}
                                  onClick={() => downloadCampaign(camp)}
                                >
                                  <span className="campaign-name">{camp.name}</span>
                                  <span className="muted">
                                    {camp.start_date ?? "—"} → {camp.finish_date ?? "—"}
                                  </span>
                                  <span className="muted">
                                    {camp.package_count} packages · {camp.return_count} returns
                                  </span>
                                  <span className="download">
                                    {exporting === camp.id ? "Preparing…" : "Download .xlsx"}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {panel?.kind === "users" && (
        <div className="card">
          <h2>{openCustomer?.name}: current users</h2>

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
                  setForm({ ...form, role: e.target.value as "superadmin" | "user" })
                }
              >
                <option value="superadmin">super-admin — runs campaigns &amp; accounts</option>
                <option value="user">user — processes returns only</option>
              </select>
            </label>
            <button disabled={busy}>{busy ? "…" : "Add user"}</button>
          </form>
          <p className="muted">
            Passwords must be 8–100 characters. Emails are unique across the whole platform, and a new
            account can log in straight away.
          </p>

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
                            onClick={() => setUserActive(u, u.is_active !== 1)}
                          >
                            {u.is_active === 1 ? "Deactivate" : "Activate"}
                          </button>
                          {confirmDelete === u.id ? (
                            <>
                              <button type="button" disabled={busy} onClick={() => deleteUser(u)}>
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
                {activeUsers} active · {users.length - activeUsers} disabled. A disabled user cannot log
                in and its open sessions end at once. A user that recorded returns can only be disabled,
                never deleted.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
