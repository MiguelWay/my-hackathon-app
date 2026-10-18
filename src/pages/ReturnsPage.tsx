import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { ReturnCounters } from "../components/ReturnCounters";
import { ReturnPackageList } from "../components/ReturnPackageList";
import { StoreIdReport } from "../components/StoreIdReport";

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
  attempt_no: number;
  resent_at: string | null;
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
  attempt_no: number;
  resent_at: string | null;
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
  // Bumped after a return or resend, so an open return package list reloads.
  const [listRefresh, setListRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The outcome of a resend save, shown beside the button that was pressed.
  const [resendError, setResendError] = useState<string | null>(null);
  // What the last recorded change was, shown beside the search button — the same place every time.
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // A resend just recorded: its row stays below the package, with the package it created under that.
  const [lastResend, setLastResend] = useState<{
    original: string;
    created: string;
    card: Match | null;
  } | null>(null);
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
    setConfirmation(null);
    setLastResend(null);
    setResendError(null);
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
    setConfirmation(null);
    setLastResend(null);
    setResendError(null);
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
    setResendError(null);
    setConfirmation(null);
    setBusy(true);
    try {
      const res = await api.post<{ reasonLabel: string }>("/returns", {
        senderId: match.sender_id,
        packageId: match.id,
        reasonCode: reason.code,
        note: notes[match.id] ?? "",
      });
      setConfirmation(`Return recorded — "${res.reasonLabel}" for ${match.sender_id}.`);
      setMatches(await lookup(match.sender_id));
      await loadHead();
      setListRefresh((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the return");
    } finally {
      setBusy(false);
    }
  }

  async function saveResend(match: Match) {
    const form = resends[match.id];
    if (!form || !form.senderId.trim()) {
      setResendError("Type the new package ID.");
      return;
    }
    setResendError(null);
    setError(null);
    setConfirmation(null);
    setBusy(true);
    try {
      // No campaign is sent: a resend stays in the original package's campaign.
      const res = await api.post<{ id: number; senderId: string }>("/returns/resend", {
        packageId: match.id,
        newSenderId: form.senderId.trim(),
      });
      setResends({});
      const created = await lookup(res.senderId);
      setLastResend({ original: match.sender_id, created: res.senderId, card: created[0] ?? null });
      // Keep the package being worked on on screen: the resend row belongs under its card, and the
      // package the resend created is shown below that row.
      setMatches(await lookup(match.sender_id));
      await loadHead();
      setListRefresh((n) => n + 1);
    } catch (err) {
      setResendError(err instanceof Error ? err.message : "Could not save the resend");
    } finally {
      setBusy(false);
    }
  }

  const onlyMatch = matches !== null && matches.length === 1 ? matches[0] : null;
  // The next attempt in this package's chain, when it has already been sent again.
  const successor = onlyMatch
    ? onlyMatch.chain.find((n) => n.attempt_no > onlyMatch.attempt_no) ?? null
    : null;
  // The resend row keeps what was saved: which package now follows which, whether it was saved just
  // now or found already resent.
  const resendSaved =
    lastResend?.created ??
    (onlyMatch && onlyMatch.return_id !== null ? successor?.sender_id ?? null : null);
  const showResendRow = lastResend !== null || (onlyMatch !== null && onlyMatch.return_id !== null);
  // The package the resend created, shown under the resend row.
  const createdCard = lastResend?.card ?? null;
  const createdExtra = createdCard ? parseExtra(createdCard.extra_columns) : {};

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
        {confirmation && <p className="ok confirmation">✓ {confirmation}</p>}
      </form>

      {head && (
        <ReturnPackageList campaignId={Number(campaignId)} refreshToken={listRefresh} />
      )}

      {head && (
        <StoreIdReport campaignId={Number(campaignId)} refreshToken={listRefresh} />
      )}

      {matches !== null && matches.length === 0 && (
        <p className="muted">No package with that ID in this campaign.</p>
      )}

      {/* The reason is the next thing an operator needs after finding the package, so it sits directly
          under the find row rather than at the foot of a long card. A sender ID is unique inside a
          campaign, so there is at most one package it can be about. */}
      {matches !== null &&
        matches.length === 1 &&
        matches[0].return_id === null &&
        lastResend === null && (
        <div className="card reason-pick">
          <label>
            Note (optional)
            <input
              value={notes[matches[0].id] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [matches[0].id]: e.target.value }))}
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
                onClick={() => record(matches[0], r)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {matches?.map((m) => {
        const extra = parseExtra(m.extra_columns);
        const returned = m.return_id !== null;
        return (
          <div className="card" key={m.id}>
            <div className="match-head">
              <strong>{m.sender_id}</strong>
              {m.attempt_no > 1 && <span className="badge">resend</span>}
              {returned && m.closed_store === 1 && <span className="chip">closed store</span>}
            </div>

            {m.chain.length > 1 && (
              <ol className="chain">
                {m.chain.map((n) => (
                  <li key={n.id} className={n.id === m.id ? "now" : ""}>
                    <span className="k">Attempt {n.attempt_no}</span>
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

            {Object.keys(extra).length > 0 && (
              <details className="section label-details">
                <summary>Label details</summary>
                <div className="kv">
                  {Object.entries(extra).map(([k, v]) => (
                    <div key={k}>
                      <span className="k">{k}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {!returned && m.attempt_no > 1 && (
              <p className="muted">
                Resent {m.resent_at ?? ""}
                {m.chain.length > 1 ? ` — replaces ${m.chain[0].sender_id}` : ""}
              </p>
            )}
          </div>
        );
      })}

      {/* The resend action, directly under the package it is about. One resend per package, so once
          the package has a later attempt the row keeps what was saved and offers no second save. */}
      {showResendRow && (
        <div className="resend-row">
          {resendSaved ? (
            <>
              <label>
                New package ID
                <input value={resendSaved} readOnly />
              </label>
              <button type="button" disabled>
                Save resend
              </button>
              <span className="resend-saved">Saved</span>
            </>
          ) : (
            onlyMatch && (
              <>
                <label>
                  New package ID
                  <input
                    value={resends[onlyMatch.id]?.senderId ?? ""}
                    onChange={(e) => {
                      setResendError(null);
                      setResends((r) => ({
                        ...r,
                        [onlyMatch.id]: { senderId: e.target.value },
                      }));
                    }}
                    placeholder="a package ID in this campaign, e.g. PortaP_21"
                  />
                </label>
                <button type="button" disabled={busy} onClick={() => saveResend(onlyMatch)}>
                  Save resend
                </button>
                {resendError && (
                  <span className="resend-error" role="alert">
                    {resendError}
                  </span>
                )}
              </>
            )
          )}
        </div>
      )}

      {/* The package the resend created, under the row that created it. The card above already shows
          the chain, so this one only needs what is new: the ID and its label columns. */}
      {createdCard && (
        <div className="card">
          <div className="match-head">
            <strong>{createdCard.sender_id}</strong>
          </div>
          {Object.keys(createdExtra).length > 0 && (
            <details className="section label-details">
              <summary>Label details</summary>
              <div className="kv">
                {Object.entries(createdExtra).map(([k, v]) => (
                  <div key={k}>
                    <span className="k">{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

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
