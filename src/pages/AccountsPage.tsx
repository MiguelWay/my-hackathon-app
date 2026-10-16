import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { PasswordInput } from "../components/PasswordInput";

interface CustomerUser {
  id: number;
  email: string;
  role: "superadmin" | "user";
  is_active: number;
  created_at: string;
}

interface NewUserForm {
  email: string;
  password: string;
  role: "superadmin" | "user";
}

const emptyForm = (): NewUserForm => ({ email: "", password: "", role: "superadmin" });

/**
 * One customer's accounts, on a page of their own.
 *
 * These used to sit under the customer's row on the Customers screen. They live here so that the
 * customers list stays about customers and their campaigns, and so that an account is managed in one
 * place with room to read it — the *Users* button on a customer's row is the way in.
 */
export function AccountsPage() {
  const { id } = useParams();
  const customerId = String(id ?? "");

  const [customerName, setCustomerName] = useState<string | null>(null);
  const [users, setUsers] = useState<CustomerUser[]>([]);
  const [form, setForm] = useState<NewUserForm>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The account whose delete has been armed, so deleting is never one careless click.
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const loadUsers = useCallback(async () => {
    setUsers(await api.get<CustomerUser[]>(`/admin/customers/${customerId}/users`));
  }, [customerId]);

  useEffect(() => {
    // The name is for the heading only, and the admin list already carries it.
    api
      .get<{ id: number; name: string }[]>("/admin/customers")
      .then((list) => setCustomerName(list.find((c) => String(c.id) === customerId)?.name ?? null))
      .catch(() => setCustomerName(null));
    loadUsers().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Failed to load the accounts")
    );
  }, [customerId, loadUsers]);

  async function addUser(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const created = await api.post<CustomerUser>(`/admin/customers/${customerId}/users`, {
        email: form.email,
        password: form.password,
        role: form.role,
      });
      setNotice(`Created ${created.role === "superadmin" ? "super-admin" : "user"} ${created.email}.`);
      setForm(emptyForm());
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the account");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(user: CustomerUser, active: boolean) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.patch(`/admin/users/${user.id}`, { active });
      setNotice(`${active ? "Activated" : "Deactivated"} ${user.email}.`);
      setConfirmDelete(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change that account");
    } finally {
      setBusy(false);
    }
  }

  async function remove(user: CustomerUser) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.delete(`/admin/users/${user.id}`);
      setNotice(`Deleted ${user.email}.`);
      setConfirmDelete(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that account");
    } finally {
      setBusy(false);
    }
  }

  const active = users.filter((u) => u.is_active === 1).length;

  return (
    <div>
      <p>
        <Link to={`/customers?customer=${customerId}`}>← Customers</Link>
      </p>
      <h1>Accounts{customerName ? ` · ${customerName}` : ""}</h1>
      <p className="muted">
        Who may sign in for this customer. Emails are unique across the whole platform, and a new
        account can log in straight away.
      </p>

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      <details className="card" open>
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
              onChange={(e) => setForm({ ...form, role: e.target.value as "superadmin" | "user" })}
            >
              <option value="superadmin">super-admin — runs campaigns &amp; accounts</option>
              <option value="user">user — processes returns</option>
            </select>
          </label>
          <button disabled={busy}>{busy ? "…" : "Add user"}</button>
        </form>
        <p className="muted">Passwords must be 8–100 characters.</p>
      </details>

      <h2>Current users</h2>
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
                    {u.is_active === 1 ? "active" : <span className="chip">disabled</span>}
                  </td>
                  <td className="muted">{u.created_at.slice(0, 10)}</td>
                  <td>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => setActive(u, u.is_active !== 1)}
                      >
                        {u.is_active === 1 ? "Deactivate" : "Activate"}
                      </button>
                      {confirmDelete === u.id ? (
                        <>
                          <button type="button" disabled={busy} onClick={() => remove(u)}>
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
            {active} active · {users.length - active} disabled. A disabled user cannot log in and its
            open sessions end at once. A user that recorded returns can only be disabled, never deleted.
          </p>
        </>
      )}
    </div>
  );
}
