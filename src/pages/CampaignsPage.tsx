import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

interface Campaign {
  id: number;
  name: string;
  start_date: string | null;
  finish_date: string | null;
  upload_count: number;
  total_rows: number;
  /** Only on the platform list: the company the campaign belongs to. */
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

  const [items, setItems] = useState<Campaign[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [customers, setCustomers] = useState<CustomerRef[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [finishDate, setFinishDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [campaigns, lists] = await Promise.all([
      api.get<Campaign[]>(picksCompany ? "/admin/campaigns" : "/campaigns"),
      api.get<Upload[]>(picksCompany ? "/admin/campaigns/uploads" : "/campaigns/uploads"),
    ]);
    setItems(campaigns);
    setUploads(lists);
  }

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [picksCompany]);

  // The company selector's options. A company super-admin can read the same admin list, so the one
  // company it is allowed to use is always available to name.
  useEffect(() => {
    if (!isSuperAdmin) return;
    api
      .get<CustomerRef[]>("/admin/customers")
      .then(setCustomers)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load customers"));
  }, [isSuperAdmin]);

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

  return (
    <div>
      <h1>Campaigns</h1>

      {!isSuperAdmin && (
        <p className="muted">Only a super-admin can create campaigns and upload lists.</p>
      )}

      {error && <p className="error">{error}</p>}

      {isSuperAdmin && (
        <details className="card">
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
              Name
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

      {items.length === 0 ? (
        <p className="muted">No campaigns yet.</p>
      ) : (
        items.map((c) => {
          const lists = listsByCampaign.get(c.id) ?? [];
          return (
            <section className="campaign-block" key={c.id}>
              <div className="campaign-head">
                <Link className="campaign-title" to={`/campaigns/${c.id}`}>
                  {c.name}
                </Link>
                {c.customer_name && <span className="badge">{c.customer_name}</span>}
                <span className="muted">
                  {c.start_date ?? "—"} → {c.finish_date ?? "—"}
                </span>
                <span className="muted">
                  {c.upload_count} list{c.upload_count === 1 ? "" : "s"} · {c.total_rows} line
                  {c.total_rows === 1 ? "" : "s"}
                </span>
              </div>

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
            </section>
          );
        })
      )}
    </div>
  );
}
