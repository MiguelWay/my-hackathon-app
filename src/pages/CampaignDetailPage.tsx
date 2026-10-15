import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { api, baseUrl } from "../lib/api";
import { guessSenderColumn } from "../lib/senderColumn";
import { useAuth } from "../auth/AuthContext";

interface Campaign {
  id: number;
  name: string;
  start_date: string | null;
  finish_date: string | null;
}

interface Upload {
  id: number;
  filename: string | null;
  columns: string[];
  row_count: number;
  created_at: string;
}

interface PackageRow {
  id: number;
  upload_id: number;
  source_row: number;
  sender_id: string;
  extra_columns: Record<string, string> | string;
  created_at: string;
}

interface ImportResult {
  uploadId: number;
  imported: number;
  columns: string[];
  senderColumn: { index: number; name: string };
}

function parseExtra(value: PackageRow["extra_columns"]): Record<string, string> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return value ?? {};
}

export function CampaignDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "superadmin";

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [senderIdx, setSenderIdx] = useState(-1);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [c, u, p] = await Promise.all([
      api.get<Campaign>(`/campaigns/${id}`),
      api.get<Upload[]>(`/campaigns/${id}/uploads`),
      api.get<PackageRow[]>(`/campaigns/${id}/packages`),
    ]);
    setCampaign(c);
    setUploads(u);
    setPackages(p);
  }, [id]);

  useEffect(() => {
    load().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Failed to load campaign")
    );
  }, [load]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
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
      setFileName(file.name);
      setSenderIdx(guessSenderColumn(hdrs));
    } catch (err) {
      setHeaders([]);
      setRows([]);
      setFileName(null);
      setError(err instanceof Error ? err.message : "Could not read the file");
    }
  }

  async function confirm() {
    if (senderIdx < 0) {
      setError("Pick the package ID column.");
      return;
    }
    setError(null);
    setNotice(null);
    setImporting(true);
    try {
      const result = await api.post<ImportResult>(`/campaigns/${id}/packages`, {
        filename: fileName,
        columns: headers,
        senderColumn: senderIdx,
        rows,
      });
      setNotice(
        `Imported ${result.imported} packages · package ID column: "${result.senderColumn.name}" · ` +
          `${result.columns.length} columns kept verbatim.`
      );
      setHeaders([]);
      setRows([]);
      setFileName(null);
      if (inputRef.current) inputRef.current.value = "";
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function downloadExport() {
    setError(null);
    setNotice(null);
    setExporting(true);
    try {
      const res = await fetch(`${baseUrl}/campaigns/${id}/export`, { credentials: "include" });
      if (!res.ok) {
        let message = res.statusText;
        try {
          const body: unknown = await res.json();
          if (body && typeof body === "object" && "error" in body) message = String(body.error);
        } catch {
          /* not JSON */
        }
        throw new Error(message);
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(disposition);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = named?.[1] ?? `campaign-${id}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${packages.length} packages.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  // Every extra column we've stored for this campaign, in first-seen order.
  const extraKeys = useMemo(() => {
    const keys: string[] = [];
    for (const p of packages) {
      for (const k of Object.keys(parseExtra(p.extra_columns))) {
        if (!keys.includes(k)) keys.push(k);
      }
    }
    return keys;
  }, [packages]);

  const totalRows = uploads.reduce((sum, u) => sum + u.row_count, 0);

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

      {!isSuperAdmin && <p className="muted">Only a super-admin can upload lists.</p>}

      {isSuperAdmin && (
        <div className="card">
          <h2>Upload campaign list (.xlsx)</h2>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={onFile} />
          <p className="muted">
            One campaign can hold several uploads; package IDs must be unique within the campaign.
          </p>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      {headers.length > 0 && (
        <>
          <div className="card inline">
            <label>
              Choose package ID column
              <select value={senderIdx} onChange={(e) => setSenderIdx(Number(e.target.value))}>
                {senderIdx < 0 && <option value={-1}>— select a column —</option>}
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `(column ${i + 1})`}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted">{rows.length} rows</span>
            <button onClick={confirm} disabled={importing}>
              {importing ? "Importing…" : "Confirm mapping & import"}
            </button>
          </div>

          {senderIdx < 0 && (
            <p className="muted">
              Couldn&rsquo;t tell which column holds the package ID — choose it above. The preview
              below shows the first rows so you can spot the right one.
            </p>
          )}

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

      <h2>Stored packages ({packages.length})</h2>
      <div className="card inline">
        <span className="muted">
          {uploads.length} upload{uploads.length === 1 ? "" : "s"} · {totalRows} row
          {totalRows === 1 ? "" : "s"} parsed
          {uploads.length > 0 && ` · latest: ${uploads[0].filename ?? "unknown file"}`}
        </span>
        <button
          type="button"
          className="secondary"
          onClick={downloadExport}
          disabled={exporting || packages.length === 0}
        >
          {exporting ? "Preparing…" : "Download .xlsx"}
        </button>
      </div>

      {packages.length === 0 ? (
        <p className="muted">Nothing uploaded yet.</p>
      ) : (
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>#</th>
                <th>Package ID</th>
                {extraKeys.map((k) => (
                  <th key={k}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => {
                const extra = parseExtra(p.extra_columns);
                return (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>{p.sender_id}</td>
                    {extraKeys.map((k) => (
                      <td key={k}>{extra[k] ?? ""}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
