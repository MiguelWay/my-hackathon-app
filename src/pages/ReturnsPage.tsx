import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

interface Reason {
  id: number;
  code: string;
  label: string;
  closed_store: number;
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

interface ResendForm {
  senderId: string;
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
  const navigate = useNavigate();
  // A super-admin runs the campaigns and links resends; a `user` only records returns.
  const isSuperAdmin = user?.role === "superadmin";
  const hasCompany = user?.customerId != null;

  const [reasons, setReasons] = useState<Reason[]>([]);
  const [term, setTerm] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [resends, setResends] = useState<Record<number, ResendForm>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /** Clears the current lookup and puts the cursor back in the search box, ready for the next box. */
  function recordAnother() {
    setTerm("");
    setMatches(null);
    setNotes({});
    setResends({});
    setError(null);
    searchRef.current?.focus();
  }

  const loadReference = useCallback(async () => {
    setReasons(await api.get<Reason[]>("/returns/reasons"));
  }, []);

  useEffect(() => {
    // A platform super-admin with no company attached has no returns to show.
    if (!hasCompany) return;
    loadReference().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Failed to load return reasons")
    );
  }, [hasCompany, loadReference]);

  const lookup = useCallback(async (senderId: string) => {
    return api.get<Match[]>(`/returns/lookup?senderId=${encodeURIComponent(senderId)}`);
  }, []);

  async function search(e: FormEvent) {
    e.preventDefault();
    const senderId = term.trim();
    if (!senderId) {
      setError("Type a package ID first.");
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
      setError("Type the new package ID.");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      // No campaign is sent: a resend stays in the original package's campaign.
      const res = await api.post<{ senderId: string; campaignId: number; campaignName: string }>(
        "/returns/resend",
        { packageId: match.id, newSenderId: form.senderId.trim() }
      );
      setResends({});
      // Straight to the record of what was just done: the original now names its replacement.
      navigate("/returns/recent", {
        state: {
          resent: {
            original: match.sender_id,
            replacement: res.senderId,
            campaignName: res.campaignName,
          },
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the resend");
    } finally {
      setBusy(false);
    }
  }

  if (!hasCompany) {
    return (
      <div>
        <h1>Packages returns</h1>
        <p className="muted">
          This account is not attached to a company, so it has no returns to process. Create
          companies and their accounts on the <Link to="/superadmin/customers">Customers</Link>{" "}
          screen.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Packages returns</h1>
      <p className="muted">
        Type the package ID printed on the returned package. A package can be returned once.
      </p>

      <form className="card inline" onSubmit={search}>
        <label>
          Package ID
          <input
            ref={searchRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="e.g. PortaP_1"
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
        <p className="muted">No package with that ID in your account.</p>
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

            {returned && isSuperAdmin && (
              <div className="resend">
                <p className="muted">
                  Sent it again? Record the new package ID — it stays in this campaign.
                </p>
                <div className="btn-row">
                  <label>
                    New package ID
                    <input
                      value={form.senderId}
                      onChange={(e) =>
                        setResends((r) => ({ ...r, [m.id]: { ...form, senderId: e.target.value } }))
                      }
                      placeholder="e.g. PortaP_151"
                    />
                  </label>
                  <button type="button" disabled={busy} onClick={() => saveResend(m)}>
                    Save resend
                  </button>
                </div>
              </div>
            )}

            {returned && !isSuperAdmin && (
              <p className="muted">Only a super-admin can record a resend.</p>
            )}
          </div>
        );
      })}

      {matches !== null && (
        <div className="btn-row next-action">
          <button type="button" onClick={recordAnother} disabled={busy}>
            {matches.length > 0 ? "Record another package" : "Search again"}
          </button>
        </div>
      )}

      <p className="muted">
        Recorded returns are listed on <Link to="/returns/recent">Return packages</Link>.
      </p>
    </div>
  );
}
