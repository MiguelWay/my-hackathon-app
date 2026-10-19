import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { PasswordInput } from "../components/PasswordInput";
import { useI18n } from "../i18n/I18nContext";

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
  const { t } = useI18n();
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
      setError(e instanceof Error ? e.message : t("users.loadFailed"))
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
      setNotice(
        t("users.created", {
          role: t(created.role === "superadmin" ? "users.roleNameSuperadmin" : "users.roleNameUser"),
          email: created.email,
        })
      );
      setForm(emptyForm());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("users.createFailed"));
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
      setNotice(t(active ? "users.activated" : "users.deactivated", { email: account.email }));
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("users.changeFailed"));
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
      setNotice(t("users.deleted", { email: account.email }));
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("users.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  const active = accounts.filter((u) => u.is_active === 1).length;

  return (
    <div>
      <h1>{t("users.title")}</h1>
      <p className="muted">{t("users.help")}</p>

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      <details className="card" open>
        <summary>{t("users.newUser")}</summary>
        <form className="customer-row" onSubmit={addUser}>
          <label>
            {t("users.email")}
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder={t("users.emailPlaceholder")}
              required
            />
          </label>
          <label>
            {t("users.password")}
            <PasswordInput
              value={form.password}
              onChange={(password) => setForm({ ...form, password })}
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <label>
            {t("users.role")}
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as "superadmin" | "user" })}
            >
              <option value="superadmin">{t("users.roleSuperadmin")}</option>
              <option value="user">{t("users.roleUser")}</option>
            </select>
          </label>
          <button disabled={busy}>{busy ? "…" : t("users.addUser")}</button>
        </form>
        <p className="muted">{t("users.passwordHint")}</p>
      </details>

      <h2>{t("users.current")}</h2>
      {accounts.length === 0 ? (
        <p className="muted">{t("users.empty")}</p>
      ) : (
        <>
          <div className="scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>{t("users.emailHeader")}</th>
                  <th>{t("users.customer")}</th>
                  <th>{t("users.roleHeader")}</th>
                  <th>{t("users.status")}</th>
                  <th>{t("users.added")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>
                      {u.customer_name ?? <span className="muted">{t("users.platform")}</span>}
                    </td>
                    <td>
                      <span className={`badge role-${u.role}`}>
                        {t(
                          u.role === "superadmin"
                            ? "header.roleSuperadmin"
                            : "header.roleUser"
                        )}
                      </span>
                    </td>
                    <td>
                      {u.is_active === 1 ? (
                        t("users.active")
                      ) : (
                        <span className="chip">{t("users.disabled")}</span>
                      )}
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
                          {u.is_active === 1 ? t("users.deactivate") : t("users.activate")}
                        </button>
                        {confirmDelete === u.id ? (
                          <>
                            <button type="button" disabled={busy} onClick={() => remove(u)}>
                              {t("users.confirmDelete")}
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy}
                              onClick={() => setConfirmDelete(null)}
                            >
                              {t("users.cancel")}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => setConfirmDelete(u.id)}
                          >
                            {t("users.delete")}
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
            {t("users.summary", { active, disabled: accounts.length - active })}
          </p>
        </>
      )}
    </div>
  );
}
