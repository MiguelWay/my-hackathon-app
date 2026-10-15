import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { CampaignListUpload } from "../components/CampaignListUpload";
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
  filename: string | null;
  row_count: number;
  created_at: string;
}

export function CampaignsPage() {
  const { user } = useAuth();
  // A super-admin runs the campaigns; a `user` only processes returns.
  const isSuperAdmin = user?.role === "superadmin";
  const [items, setItems] = useState<Campaign[]>([]);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [finishDate, setFinishDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The campaign a list is being added to, and the one whose uploaded lists are open below.
  const [target, setTarget] = useState("");
  const [openLists, setOpenLists] = useState<number | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);

  async function load() {
    setItems(await api.get<Campaign[]>("/campaigns"));
  }

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  // Start on the newest campaign: the one you are most likely adding a list to.
  useEffect(() => {
    if (!target && items.length > 0) setTarget(String(items[0].id));
  }, [items, target]);

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

  async function toggleLists(campaignId: number) {
    if (openLists === campaignId) {
      setOpenLists(null);
      setUploads([]);
      return;
    }
    setOpenLists(campaignId);
    setError(null);
    try {
      setUploads(await api.get<Upload[]>(`/campaigns/${campaignId}/uploads`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the uploaded lists");
    }
  }

  /** After an import: refresh the counts, and the open panel when it is that campaign's. */
  async function afterImport(campaignId: number) {
    try {
      await load();
      if (openLists === campaignId) {
        setUploads(await api.get<Upload[]>(`/campaigns/${campaignId}/uploads`));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh the campaigns");
    }
  }

  const openCampaign = items.find((c) => c.id === openLists);
  const openLines = uploads.reduce((sum, u) => sum + u.row_count, 0);

  return (
    <div>
      <h1>Campaigns</h1>

      {!isSuperAdmin && (
        <p className="muted">Only a super-admin can create campaigns and upload lists.</p>
      )}

      {error && <p className="error">{error}</p>}

      {isSuperAdmin && (
        <form className="card inline" onSubmit={create}>
          <h2>New campaign</h2>
          <p className="muted">
            Start and finish dates are required: a campaign without a window cannot be reported on.
          </p>
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
      )}

      {isSuperAdmin && (
        <div className="card">
          <h2>Add a list to an existing campaign</h2>
          {items.length === 0 ? (
            <p className="muted">Create a campaign first — every list belongs to one.</p>
          ) : (
            <>
              <div className="customer-row">
                <label>
                  Campaign
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    {items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.total_rows} lines
                      </option>
                    ))}
                  </select>
                </label>
                <span className="muted">
                  The list joins that campaign; package IDs must be unique within it.
                </span>
              </div>
              {target !== "" && (
                <CampaignListUpload
                  key={target}
                  campaignId={Number(target)}
                  onImported={() => afterImport(Number(target))}
                />
              )}
            </>
          )}
        </div>
      )}

      <h2>All campaigns</h2>
      <table className="grid">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Start</th>
            <th>Finish</th>
            <th>Lists</th>
            <th>Lines</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td>
                <Link to={`/campaigns/${c.id}`}>{c.name}</Link>
              </td>
              <td>{c.start_date ?? "—"}</td>
              <td>{c.finish_date ?? "—"}</td>
              <td>{c.upload_count}</td>
              <td>{c.total_rows}</td>
              <td>
                <button
                  type="button"
                  className="secondary"
                  disabled={c.upload_count === 0}
                  onClick={() => toggleLists(c.id)}
                >
                  {openLists === c.id ? "Close" : "Lists"}
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No campaigns yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {openLists !== null && (
        <div className="card">
          <h2>{openCampaign?.name}: uploaded lists</h2>
          {uploads.length === 0 ? (
            <p className="muted">No lists uploaded to this campaign yet.</p>
          ) : (
            <>
              <div className="scroll">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>File</th>
                      <th>Lines</th>
                      <th>Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploads.map((u) => (
                      <tr key={u.id}>
                        <td>{u.id}</td>
                        <td>{u.filename ?? "unknown file"}</td>
                        <td>{u.row_count}</td>
                        <td>{u.created_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                {uploads.length} list{uploads.length === 1 ? "" : "s"} · {openLines} lines.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
