import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

interface Reason {
  id: number;
  code: string;
  label: string;
  closed_store: number;
}

interface Campaign {
  id: number;
  name: string;
}

/** One package in a chain of resends. */
interface ChainNode {
  id: number;
  sender_id: string;
  chain_id: number | null;
  created_via: string;
  created_at: string;
  campaign_name: string;
  returned_at: string | null;
  return_note: string | null;
  reason_label: string | null;
  closed_store: number | null;
}

interface Match {
  id: number;
  sender_id: string;
  chain_id: number | null;
  created_via: string;
  extra_columns: Record<string, string> | string;
  campaign_id: number;
  campaign_name: string;
  return_id: number | null;
  returned_at: string | null;
  return_note: string | null;
  reason_code: string | null;
  reason_label: string | null;
  closed_store: number | null;
  chain: ChainNode[];
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

interface ResendForm {
  senderId: string;
  campaignId: string;
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
  const isAdmin = user?.role === "admin";

  const [reasons, setReasons] = useState<Reason[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [recent, setRecent] = useState<RecentReturn[]>([]);
  const [term, setTerm] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [resends, setResends] = useState<Record<number, ResendForm>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSuperadmin = user?.role === "superadmin";

  const loadReference = useCallback(async () => {
    const [r, recentRows, camps] = await Promise.all([
      api.get<Reason[]>("/returns/reasons"),
      api.get<RecentReturn[]>("/returns"),
      isAdmin ? api.get<Campaign[]>("/campaigns") : Promise.resolve([] as Campaign[]),
    ]);
    setReasons(r);
    setRecent(recentRows);
    setCampaigns(camps);
  }, [isAdmin]);

  useEffect(() => {
    if (isSuperadmin) return;
    loadReference().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Failed to load return reasons")
    );
  }, [isSuperadmin, loadReference]);

  const lookup = useCallback(async (senderId: string) => {
    return api.get<Match[]>(`/returns/lookup?senderId=${encodeURIComponent(senderId)}`);
  }, []);

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
      setMatches(await lookup(senderId));
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
      setMatches(await lookup(match.sender_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the return");
    } finally {
      setBusy(false);
    }
  }

  async function saveResend(match: Match) {
    const form = resends[match.id];
    if (!form || !form.senderId.trim()) {
      setError("Type the new sender ID.");
      return;
    }
    if (!form.campaignId) {
      setError("Pick the campaign it was sent in.");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await api.post<{ senderId: string; campaignName: string }>("/returns/resend", {
        packageId: match.id,
        newSenderId: form.senderId.trim(),
        campaignId: Number(form.campaignId),
      });
      setNotice(`Linked ${res.senderId} as a resend in "${res.campaignName}".`);
      setResends((r) => ({ ...r, [match.id]: { senderId: "", campaignId: "" } }));
      setMatches(await lookup(match.sender_id));
      await loadReference();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the resend");
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
        const form = resends[m.id] ?? { senderId: "", campaignId: "" };
        return (
          <div className="card" key={m.id}>
            <div className="match-head">
              <strong>{m.sender_id}</strong>
              <span className="muted">campaign: {m.campaign_name}</span>
              {m.created_via === "resend" && <span className="badge">resend</span>}
              {returned && m.closed_store === 1 && <span className="chip">closed store</span>}
            </div>

            {m.chain.length > 1 && (
              <ol className="chain">
                {m.chain.map((n, i) => (
                  <li key={n.id} className={n.id === m.id ? "now" : ""}>
                    <span className="k">Attempt {i + 1}</span>
                    <span>{n.sender_id}</span>
                    <span className="muted">{n.campaign_name}</span>
                    <span className="muted">
                      {n.returned_at
                        ? `returned ${n.returned_at} · ${n.reason_label}`
                        : "not returned yet"}
                    </span>
                  </li>
                ))}
              </ol>
            )}

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

            {returned && isAdmin && (
              <div className="resend">
                <p className="muted">Sent it again? Record the new sender ID.</p>
                <div className="btn-row">
                  <label>
                    New sender ID
                    <input
                      value={form.senderId}
                      onChange={(e) =>
                        setResends((r) => ({ ...r, [m.id]: { ...form, senderId: e.target.value } }))
                      }
                      placeholder="e.g. PQ777000123ES"
                    />
                  </label>
                  <label>
                    Campaign sent in
                    <select
                      value={form.campaignId}
                      onChange={(e) =>
                        setResends((r) => ({
                          ...r,
                          [m.id]: { ...form, campaignId: e.target.value },
                        }))
                      }
                    >
                      <option value="">— pick a campaign —</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" disabled={busy} onClick={() => saveResend(m)}>
                    Save resend
                  </button>
                </div>
              </div>
            )}

            {returned && !isAdmin && (
              <p className="muted">Only an admin can record a resend.</p>
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
