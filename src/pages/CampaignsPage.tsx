import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

interface Campaign {
  id: number;
  name: string;
  start_date: string | null;
  finish_date: string | null;
}

export function CampaignsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [items, setItems] = useState<Campaign[]>([]);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [finishDate, setFinishDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setItems(await api.get<Campaign[]>("/campaigns"));
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

  return (
    <div>
      <h1>Campaigns</h1>

      {isAdmin && (
        <form className="card inline" onSubmit={create}>
          <h2>New campaign</h2>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Start date
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            Finish date
            <input type="date" value={finishDate} onChange={(e) => setFinishDate(e.target.value)} />
          </label>
          <button>Create</button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      <table className="grid">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Start</th>
            <th>Finish</th>
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
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No campaigns yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
