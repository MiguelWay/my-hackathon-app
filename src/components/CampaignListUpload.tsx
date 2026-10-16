import { useRef, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import { api } from "../lib/api";
import { guessSenderColumn } from "../lib/senderColumn";

export interface ImportResult {
  uploadId: number;
  imported: number;
  /** Rows the file had with no package ID in the chosen column; they were left out. */
  skipped: number;
  columns: string[];
  senderColumn: { index: number; name: string };
}

/**
 * Picks an .xlsx list, confirms which column holds the package ID, and imports it into one campaign.
 * Shared by the campaign screen and by "Add a list to an existing campaign" on the Campaigns screen.
 */
export function CampaignListUpload({
  campaignId,
  onImported,
}: {
  campaignId: number;
  onImported?: () => void | Promise<void>;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [senderIdx, setSenderIdx] = useState(-1);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Forgets the file that was read, so the next one starts clean. */
  function reset() {
    setHeaders([]);
    setRows([]);
    setFileName(null);
    setSenderIdx(-1);
    if (inputRef.current) inputRef.current.value = "";
  }

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
      reset();
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
      const result = await api.post<ImportResult>(`/campaigns/${campaignId}/packages`, {
        filename: fileName,
        columns: headers,
        senderColumn: senderIdx,
        rows,
      });
      // Rows with no package ID are left out rather than refused, so say so instead of hiding it.
      const skipped = result.skipped
        ? ` · left out ${result.skipped} row${result.skipped === 1 ? "" : "s"} with no package ID`
        : "";
      setNotice(
        `Imported ${result.imported} lines · package ID column: "${result.senderColumn.name}" · ` +
          `${result.columns.length} columns kept verbatim${skipped}.`
      );
      reset();
      await onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <div className="upload-input">
        <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={onFile} />
        <p className="muted">
          One campaign can hold several lists; package IDs must be unique within the campaign.
        </p>
      </div>

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
            <span className="muted">{rows.length} lines</span>
            <button type="button" onClick={confirm} disabled={importing}>
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
                      {h || `(column ${i + 1})`}
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
    </>
  );
}
