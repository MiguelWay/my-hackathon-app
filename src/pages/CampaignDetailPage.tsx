import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { api } from "../lib/api";
import { guessSenderColumn } from "../lib/senderColumn";
import { useAuth } from "../auth/AuthContext";

interface Campaign {
  id: number;
  name: string;
  start_date: string | null;
  finish_date: string | null;
}


export function CampaignDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [senderIdx, setSenderIdx] = useState(-1);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<Campaign>(`/campaigns/${id}`)
      .then(setCampaign)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load campaign"));
  }, [id]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setConfirmed(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });
      if (matrix.length < 2) throw new Error("That file has no data rows.");
      const hdrs = (matrix[0] as unknown[]).map((h) => String(h));
      const data = matrix
        .slice(1)
        .map((r) => hdrs.map((_, i) => String((r as unknown[])[i] ?? "")));
      setHeaders(hdrs);
      setRows(data);
      setSenderIdx(guessSenderColumn(hdrs));
    } catch (err) {
      setHeaders([]);
      setRows([]);
      setError(err instanceof Error ? err.message : "Could not read the file");
    }
  }

  function confirm() {
    if (senderIdx < 0) {
      setError("Pick the sender-ID column.");
      return;
    }
    setError(null);
    const unique = new Set(rows.map((r) => r[senderIdx]).filter(Boolean));
    setConfirmed(
      `Parsed ${rows.length} rows · sender-ID column: "${headers[senderIdx]}" · ` +
        `${unique.size} unique IDs. (Import is wired up in Task 6.)`
    );
  }

  return (
    <div>
      <p>
        <Link to="/">← Campaigns</Link>
      </p>
      <h1>{campaign ? campaign.name : `Campaign ${id}`}</h1>
      {campaign && (
        <p className="muted">
          Start {campaign.start_date ?? "—"} · Finish {campaign.finish_date ?? "—"}
        </p>
      )}

      {!isAdmin && <p className="muted">Only an admin can upload lists.</p>}

      {isAdmin && (
        <div className="card">
          <h2>Upload campaign list (.xlsx)</h2>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={onFile} />
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {headers.length > 0 && (
        <>
          <div className="card inline">
            <label>
              Sender-ID column
              <select value={senderIdx} onChange={(e) => setSenderIdx(Number(e.target.value))}>
                {senderIdx < 0 && <option value={-1}>— choose the sender-ID column —</option>}
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `(column ${i + 1})`}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted">{rows.length} rows</span>
            <button onClick={confirm}>Confirm mapping</button>
          </div>

          {confirmed && <p className="ok">{confirmed}</p>}

          <h2>Preview (first 10 rows)</h2>
          <div className="scroll">
            <table className="grid">
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} className={i === senderIdx ? "hl" : ""}>
                      {h || `col ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <td key={ci} className={ci === senderIdx ? "hl" : ""}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
