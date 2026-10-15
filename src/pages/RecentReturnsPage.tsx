import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

interface RecentReturn {
  id: number;
  returned_at: string;
  note: string | null;
  sender_id: string;
  campaign_id: number;
  campaign_name: string;
  reason_code: string;
  reason_label: string;
  closed_store: number;
}

/** The most recently recorded returns, newest first. */
export function RecentReturnsPage() {
  const { user } = useAuth();
  const hasCompany = user?.customerId != null;

  const [items, setItems] = useState<RecentReturn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setItems(await api.get<RecentReturn[]>("/returns"));
  }, []);

  useEffect(() => {
    if (!hasCompany) return;
    load()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [hasCompany, load]);

  if (!hasCompany) {
    return (
      <div>
        <h1>Recently recorded</h1>
        <p className="muted">
          This account is not attached to a company, so it has no returns to show.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Recently recorded</h1>
      <p className="muted">
        Your company&rsquo;s most recent returns, newest first. <Link to="/returns">Packages returns</Link>
      </p>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">Nothing recorded yet.</p>
      ) : (
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Package ID</th>
                <th>Campaign</th>
                <th>Reason</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>{r.sender_id}</td>
                  <td>
                    <Link to={`/campaigns/${r.campaign_id}`}>{r.campaign_name}</Link>
                  </td>
                  <td>
                    {r.reason_label}
                    {r.closed_store === 1 && <span className="chip">closed store</span>}
                    {r.note ? <span className="muted"> · {r.note}</span> : null}
                  </td>
                  <td>{r.returned_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
