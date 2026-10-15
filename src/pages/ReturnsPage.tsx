import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { ReturnCounters } from "../components/ReturnCounters";

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

/** The campaign this screen belongs to, with its own counters. */
interface CampaignHead {
  id: number;
  name: string;
  start_date: string | null;
  finish_date: string | null;
  customer_id: number;
  customer_name: string;
  sent: number;
  returns: number;
  resends: number;
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

/**
 * One campaign's returns — the screen an operator works in.
 *
 * Reached from the customer that owns the campaign, so the campaign is fixed by the route: there is no
 * picker here, and every lookup has a campaign behind it. The counters are that campaign's own, so the
 * operator watches their own work move rather than reading a company-wide report.
 */
export function ReturnsPage() {
  const { id } = useParams();
  const campaignId = String(id ?? "");

  const [head, setHead] = useState<CampaignHead | null>(null);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [term, setTerm] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [resends, setResends] = useState<Record<number, ResendForm>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /** The campaign's head and counters. Re-read after every change, so the numbers move as they work. */
  const loadHead = useCallback(async () => {
    setHead(await api.get<CampaignHead>(`/returns/campaigns/${campaignId}`));
  }, [campaignId]);

  useEffect(() => {
    loadHead().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Failed to load this campaign")
    );
  }, [loadHead]);

  useEffect(() => {
    // Shared configuration, identical for every campaign, so it loads once.
    api
      .get<Reason[]>("/returns/reasons")
      .then(setReasons)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load return reasons")
      );
  }, []);

  /** Always narrowed to this campaign — which is also what names the customer behind it. */
  const lookup = useCallback(
    async (senderId: string) =>
      api.get<Match[]>(
        `/returns/lookup?senderId=${encodeURIComponent(senderId)}` +
          `&campaignId=${encodeURIComponent(campaignId)}`
      ),
    [campaignId]
  );

  /** Clears the current lookup and puts the cursor back in the search box, ready for the next box. */
  function recordAnother() {
    setTerm("");
    setMatches(null);
    setNotes({});
    setResends({});
    setError(null);
    setNotice(null);
    searchRef.current?.focus();
  }

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
      await loadHead();
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
      const res = await api.post<{ senderId: string }>("/returns/resend", {
        packageId: match.id,
        newSenderId: form.senderId.trim(),
      });
      setResends({});
      setNotice(`Linked ${res.senderId} as a resend of ${match.sender_id}.`);
      // Stay here: the chain above now names its replacement, and the counters have moved.
      setMatches(await lookup(match.sender_id));
      await loadHead();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the resend");
    } finally {
      setBusy(false);
    }
  }

  /** A campaign that is not there says so, rather than showing an empty screen to work in. */
  if (!head && error) {
    return (
      <div>
        <p>
          <Link to="/customers">← Customers</Link>
        </p>
        <h1>Packages returns</h1>
        <p className="error">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <p>
        <Link to={`/customers?customer=${head?.customer_id ?? ""}`}>
          ← {head ? head.customer_name : "Customers"}
        </Link>
      </p>
      <h1>{head ? head.name : "Loading…"}</h1>
      {head && (
        <p className="muted">
          {head.customer_name} · {head.start_date ?? "—"} → {head.finish_date ?? "—"}
        </p>
      )}

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      {head && <ReturnCounters sent={head.sent} returns={head.returns} resends={head.resends} />}

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

      <p className="muted">
        Type the package ID printed on the returned package. A package can be returned once.
      </p>

      {matches !== null && matches.length === 0 && (
        <p className="muted">No package with that ID in this campaign.</p>
      )}

      {matches?.map((m) => {
        const extra = parseExtra(m.extra_columns);
        const returned = m.return_id !== null;
        const form = resends[m.id] ?? { senderId: "" };
        return (
          <div className="card" key={m.id}>
            <div className="match-head">
              <strong>{m.sender_id}</strong>
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

            {returned && (
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
    </div>
  );
}
