import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { PasswordInput } from "../components/PasswordInput";

interface Account {
  id: number;
  email: string;
  role: "superadmin" | "user";
  is_active: number;
  created_at: string;
  customer_id: number | null;
  customer_name: string | null;
}

interface NewUserForm {
  email: string;
  password: string;
  role: "superadmin" | "user";
}

const emptyForm = (): NewUserForm => ({
  email: "",
  password: "",
  role: "superadmin",
});

/**
 * Every account on the platform, in one place.
 *
 * This is the only screen that administers users: who exists, which customer they belong to, and
 * whether they may sign in. The Customers screen is about customers and their campaigns, not accounts.
 */
export function UsersPage() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState<NewUserForm>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The account whose delete has been armed, so deleting is never one careless click.
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = useCallback(async () => {
    const list = await api.get<Account[]>("/admin/users");
    setAccounts(list);
  }, []);

  useEffect(() => {
    load().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Failed to load the users")
    );
  }, [load]);

  async function addUser(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      // A platform super-admin creates accounts with no company of their own; a company super-admin's
      // new accounts belong to its company. The screen no longer asks for a customer either way.
      const path =
        user?.customerId == null
          ? "/admin/users"
          : `/admin/customers/${user.customerId}/users`;
      const created = await api.post<Account>(path, {
        email: form.email,
        password: form.password,
        role: form.role,
      });
      setNotice(`Created ${created.role === "superadmin" ? "super-admin" : "user"} ${created.email}.`);
      setForm(emptyForm());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the account");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(account: Account, active: boolean) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.patch(`/admin/users/${account.id}`, { active });
      setNotice(`${active ? "Activated" : "Deactivated"} ${account.email}.`);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change that account");
    } finally {
      setBusy(false);
    }
  }

  async function remove(account: Account) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api.delete(`/admin/users/${account.id}`);
      setNotice(`Deleted ${account.email}.`);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that account");
    } finally {
      setBusy(false);
    }
  }

  const active = accounts.filter((u) => u.is_active === 1).length;

  return (
    <div>
      <h1>Users</h1>
      <p className="muted">
        Every account that can sign in. Emails are unique across the platform, and a new account can
        sign in straight away. An operator already reaches every customer, so an account created here
        needs no customer of its own; a company super-admin's new accounts stay inside its company.
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
      {accounts.length === 0 ? (
        <p className="muted">No users yet.</p>
      ) : (
        <>
          <div className="scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Customer</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.customer_name ?? <span className="muted">platform</span>}</td>
                    <td>
                      <span className={`badge role-${u.role}`}>{u.role}</span>
                    </td>
                    <td>{u.is_active === 1 ? "active" : <span className="chip">disabled</span>}</td>
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
          </div>
          <p className="muted">
            {active} active · {accounts.length - active} disabled. A disabled user cannot log in and its
            open sessions end at once. A user that recorded returns can only be disabled, never deleted.
          </p>
        </>
      )}
    </div>
  );
}
