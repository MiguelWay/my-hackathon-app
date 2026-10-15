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
}

interface Upload {
  id: number;
  campaign_id: number;
  filename: string | null;
  row_count: number;
  created_at: string;
}

export function CampaignsPage() {
  const { user } = useAuth();
  // A super-admin runs the campaigns; a `user` only processes returns.
  const isSuperAdmin = user?.role === "superadmin";
  const [items, setItems] = useState<Campaign[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [finishDate, setFinishDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [campaigns, lists] = await Promise.all([
      api.get<Campaign[]>("/campaigns"),
      api.get<Upload[]>("/campaigns/uploads"),
    ]);
    setItems(campaigns);
    setUploads(lists);
  }

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/campaigns", {
        name,
        startDate: startDate || null,
        finishDate: finishDate || null,
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

  return (
    <div>
      {!isSuperAdmin && (
        <p className="muted">Only a super-admin can create campaigns and upload lists.</p>
      )}

      {error && <p className="error">{error}</p>}

      {isSuperAdmin && (
        <details className="card">
          <summary>New campaign</summary>
          <form className="customer-row" onSubmit={create}>
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
