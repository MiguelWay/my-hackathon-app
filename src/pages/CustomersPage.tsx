import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { PasswordInput } from "../components/PasswordInput";

interface Customer {
  id: number;
  name: string;
  created_at: string;
  user_count: number;
}

interface CustomerUser {
  id: number;
  email: string;
  role: "superadmin" | "user";
  created_at: string;
}

interface NewUserForm {
  email: string;
  password: string;
  role: "superadmin" | "user";
}

const emptyForm = (): NewUserForm => ({ email: "", password: "", role: "superadmin" });

export function CustomersPage() {
  const [items, setItems] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Which customer's "add user" form is open, and that form's values.
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [form, setForm] = useState<NewUserForm>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<CustomerUser[]>([]);

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

  async function addUser(e: FormEvent, customerId: number) {
    e.preventDefault();
    if (!openFor) return;
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
      setOpenFor(null);
      setUsers([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the account");
    } finally {
      setBusy(false);
    }
  }

  async function toggleUsers(customerId: number) {
    if (openFor === customerId) {
      setOpenFor(null);
      setUsers([]);
      setForm(emptyForm());
      return;
    }
    setOpenFor(customerId);
    setForm(emptyForm());
    setError(null);
    setNotice(null);
    try {
      setUsers(await api.get<CustomerUser[]>(`/admin/customers/${customerId}/users`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    }
  }

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
              <tr key={c.id}>
                <td>{c.id}</td>
                <td>{c.name}</td>
                <td>{c.user_count}</td>
                <td>
                  <button type="button" className="secondary" onClick={() => toggleUsers(c.id)}>
                    {openFor === c.id ? "Close" : "Users"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openFor !== null && (
        <div className="card">
          <h2>{items.find((c) => c.id === openFor)?.name}: accounts</h2>

          {users.length > 0 && (
            <ul className="user-list">
              {users.map((u) => (
                <li key={u.id}>
                  <span className={`badge role-${u.role}`}>{u.role}</span> {u.email}
                </li>
              ))}
            </ul>
          )}

          <form className="customer-row" onSubmit={(e) => addUser(e, openFor)}>
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
            <button disabled={busy}>{busy ? "…" : "Add account"}</button>
          </form>
          <p className="muted">
            Passwords must be 8–100 characters. Emails are unique across the whole platform.
          </p>
        </div>
      )}
    </div>
  );
}
