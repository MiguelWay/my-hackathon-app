import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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

/** One of a customer's campaigns, for narrowing a lookup to the one being processed. */
interface CampaignOption {
  id: number;
  name: string;
}

/** A customer the operator can work in. One team handles returns for every client company. */
interface CustomerOption {
  id: number;
  name: string;
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
  // The Customers screen sends the customer and the campaign it was asked about, so the operator
  // lands on them.
  const [searchParams] = useSearchParams();
  const requestedCustomer = searchParams.get("customer") ?? "";
  const requestedCampaign = searchParams.get("campaign") ?? "";

  const [reasons, setReasons] = useState<Reason[]>([]);
  const [term, setTerm] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [resends, setResends] = useState<Record<number, ResendForm>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Whose returns: pick a customer, then optionally narrow to one of its campaigns ("" = all of them).
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedName = campaigns.find((c) => String(c.id) === selectedCampaign)?.name;

  /** Clears the current lookup and puts the cursor back in the search box, ready for the next box. */
  function recordAnother() {
    setTerm("");
    setMatches(null);
    setNotes({});
    setResends({});
    setError(null);
    searchRef.current?.focus();
  }

  /** Moving to another customer drops everything that belonged to the last one. */
  function chooseCustomer(id: string) {
    setSelectedCustomer(id);
    setSelectedCampaign("");
    setTerm("");
    setMatches(null);
    setNotes({});
    setResends({});
    setError(null);
    setNotice(null);
  }

  function chooseCampaign(id: string) {
    setSelectedCampaign(id);
    setMatches(null);
    setError(null);
    setNotice(null);
    searchRef.current?.focus();
  }

  const loadReference = useCallback(async () => {
    setReasons(await api.get<Reason[]>("/returns/reasons"));
  }, []);

  useEffect(() => {
    // The reasons are shared by every customer, so they load once and the screen is ready either way.
    loadReference().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Failed to load return reasons")
    );
  }, [loadReference]);

  // The customer directory. The operator's own choice wins; failing that the customer they came in on,
  // then their own company.
  useEffect(() => {
    api
      .get<CustomerOption[]>("/returns/customers")
      .then((list) => {
        setCustomers(list);
        setSelectedCustomer((current) => {
          if (current && list.some((c) => String(c.id) === current)) return current;
          const fromUrl = list.find((c) => String(c.id) === requestedCustomer);
          if (fromUrl) return String(fromUrl.id);
          const own = list.find((c) => c.id === user?.customerId);
          return own ? String(own.id) : "";
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load customers"))
      .finally(() => setLoadingCustomers(false));
  }, [requestedCustomer, user?.customerId]);

  // Then that customer's campaigns. Changing customer drops any campaign chosen under the old one.
  useEffect(() => {
    if (!selectedCustomer) {
      setCampaigns([]);
      setSelectedCampaign("");
      return;
    }
    api
      .get<CampaignOption[]>(`/returns/customers/${selectedCustomer}/campaigns`)
      .then((list) => {
        setCampaigns(list);
        setSelectedCampaign(
          list.some((c) => String(c.id) === requestedCampaign) ? requestedCampaign : ""
        );
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load campaigns"));
  }, [selectedCustomer, requestedCampaign]);

  const lookup = useCallback(
    async (senderId: string, customerId: string, campaignId: string) => {
      const only = campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : "";
      return api.get<Match[]>(
        `/returns/lookup?senderId=${encodeURIComponent(senderId)}` +
          `&customerId=${encodeURIComponent(customerId)}${only}`
      );
    },
    []
  );

  async function search(e: FormEvent) {
    e.preventDefault();
    const senderId = term.trim();
    if (!selectedCustomer) {
      setError("Pick a customer first.");
      return;
    }
    if (!senderId) {
      setError("Type a package ID first.");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    setNotes({});
    try {
      setMatches(await lookup(senderId, selectedCustomer, selectedCampaign));
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
        customerId: Number(selectedCustomer),
        reasonCode: reason.code,
        note: notes[match.id] ?? "",
      });
      setNotice(`Recorded "${res.reasonLabel}" for ${match.sender_id}.`);
      setMatches(await lookup(match.sender_id, selectedCustomer, selectedCampaign));
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

  if (!loadingCustomers && customers.length === 0) {
    return (
      <div>
        <h1>Packages returns</h1>
        <p className="muted">
          There are no customers yet, so there is nothing to process here. Create one on the{" "}
          <Link to="/superadmin/customers">Customers</Link> screen.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Packages returns</h1>
      <p className="muted">
        Pick the customer, then the campaign, then type the package ID printed on the returned package.
        A package can be returned once.
      </p>

      <div className="workspace">
        <aside className="rail">
          <h2>Customers</h2>
          <ul className="picker">
            {customers.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={String(c.id) === selectedCustomer ? "picker-item now" : "picker-item"}
                  onClick={() => chooseCustomer(String(c.id))}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>

          {selectedCustomer !== "" && (
            <>
              <h2>Campaigns</h2>
              <ul className="picker">
                <li>
                  <button
                    type="button"
                    className={selectedCampaign === "" ? "picker-item now" : "picker-item"}
                    onClick={() => chooseCampaign("")}
                  >
                    All campaigns
                  </button>
                </li>
                {campaigns.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={
                        String(c.id) === selectedCampaign ? "picker-item now" : "picker-item"
                      }
                      onClick={() => chooseCampaign(String(c.id))}
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <section className="pane">
          {selectedCustomer === "" ? (
            <p className="muted">Pick a customer on the left to start.</p>
          ) : (
            <>
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

              {requestedCampaign &&
                campaigns.length > 0 &&
                !campaigns.some((c) => String(c.id) === requestedCampaign) && (
                  <p className="muted">
                    That campaign is not this customer&rsquo;s, so nothing was narrowed to it.
                  </p>
                )}

              {error && <p className="error">{error}</p>}
              {notice && <p className="ok">{notice}</p>}

              {matches !== null && matches.length === 0 && (
                <p className="muted">
                  No package with that ID{selectedName ? ` in ${selectedName}` : " for this customer"}.
                </p>
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

              <p className="muted">
                Recorded returns are listed on <Link to="/returns/recent">Returned Packages</Link>.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
