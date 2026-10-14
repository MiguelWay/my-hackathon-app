import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

interface Reason {
  id: number;
  code: string;
  label: string;
  closed_store: number;
}

interface Match {
  id: number;
  sender_id: string;
  extra_columns: Record<string, string> | string;
  campaign_id: number;
  campaign_name: string;
  return_id: number | null;
  returned_at: string | null;
  return_note: string | null;
  reason_code: string | null;
  reason_label: string | null;
  closed_store: number | null;
}

interface RecentReturn {
  id: number;
  returned_at: string;
  note: string | null;
  sender_id: string;
  campaign_name: string;
  reason_code: string;
  reason_label: string;
  closed_store: number;
}

function parseExtra(value: Match["extra_columns"]): Record<string, string> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return value ?? {};
}

export function ReturnsPage() {
  const { user } = useAuth();
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [recent, setRecent] = useState<RecentReturn[]>([]);
  const [term, setTerm] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSuperadmin = user?.role === "superadmin";

  const loadRecent = useCallback(async () => {
    const [r, recentRows] = await Promise.all([
      api.get<Reason[]>("/returns/reasons"),
      api.get<RecentReturn[]>("/returns"),
    ]);
    setReasons(r);
    setRecent(recentRows);
  }, []);

  useEffect(() => {
    if (isSuperadmin) return;
    loadRecent().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Failed to load return reasons")
    );
  }, [isSuperadmin, loadRecent]);

  async function search(e: FormEvent) {
    e.preventDefault();
    const senderId = term.trim();
    if (!senderId) {
      setError("Type a sender ID first.");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    setNotes({});
    try {
      const found = await api.get<Match[]>(
        `/returns/lookup?senderId=${encodeURIComponent(senderId)}`
      );
      setMatches(found);
    } catch (err) {
      setMatches(null);
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  async function record(match: Match, reason: Reason) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await api.post<{ reasonLabel: string }>("/returns", {
        senderId: match.sender_id,
        packageId: match.id,
        reasonCode: reason.code,
        note: notes[match.id] ?? "",
      });
      setNotice(`Recorded "${res.reasonLabel}" for ${match.sender_id}.`);
      const [found] = await Promise.all([
        api.get<Match[]>(`/returns/lookup?senderId=${encodeURIComponent(match.sender_id)}`),
        loadRecent(),
      ]);
      setMatches(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the return");
    } finally {
      setBusy(false);
    }
  }

  if (isSuperadmin) {
    return (
      <div>
        <h1>Process returns</h1>
        <p className="muted">
          Super-admins manage customers. Sign in as one of a customer&rsquo;s admins or users to
          process returns.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Process returns</h1>
      <p className="muted">
        Type the sender ID printed on the returned package. A package can be returned once.
      </p>

      <form className="card inline" onSubmit={search}>
        <label>
          Sender ID
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="e.g. PQ987654321ES"
            autoFocus
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Working…" : "Find package"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      {matches !== null && matches.length === 0 && (
        <p className="muted">No package with that sender ID in your account.</p>
      )}

      {matches?.map((m) => {
        const extra = parseExtra(m.extra_columns);
        const returned = m.return_id !== null;
        return (
          <div className="card" key={m.id}>
            <div className="match-head">
              <strong>{m.sender_id}</strong>
              <span className="muted">campaign: {m.campaign_name}</span>
              {returned && m.closed_store === 1 && <span className="chip">closed store</span>}
            </div>

            <div className="kv">
              {Object.entries(extra).map(([k, v]) => (
                <div key={k}>
                  <span className="k">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>

            {returned ? (
              <p className="ok">
                Returned {m.returned_at} · {m.reason_label}
                {m.return_note ? ` · ${m.return_note}` : ""}
              </p>
            ) : (
              <>
                <label>
                  Note (optional)
                  <input
                    value={notes[m.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [m.id]: e.target.value }))}
                    placeholder="e.g. second visit"
                  />
                </label>
                <p className="muted">Reason</p>
                <div className="btn-row">
                  {reasons.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => record(m, r)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}

      <h2>Recently recorded</h2>
      {recent.length === 0 ? (
        <p className="muted">Nothing recorded yet.</p>
      ) : (
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Sender ID</th>
                <th>Campaign</th>
                <th>Reason</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>{r.sender_id}</td>
                  <td>{r.campaign_name}</td>
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
