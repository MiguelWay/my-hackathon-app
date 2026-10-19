import { useRef, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import { api } from "../lib/api";
import { useI18n } from "../i18n/I18nContext";
import { guessSenderColumn } from "../lib/senderColumn";
import { guessStoreColumn } from "../lib/storeColumn";
import {
  ACCEPT_ATTRIBUTE,
  decodeSpreadsheetText,
  guessDelimiter,
  isDelimitedFile,
} from "../lib/tableFile";

export interface ImportResult {
  uploadId: number;
  imported: number;
  /** Rows the file had with no package ID in the chosen column; they were left out. */
  skipped: number;
  columns: string[];
  senderColumn: { index: number; name: string };
  storeColumn: { index: number; name: string };
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
  const [storeIdx, setStoreIdx] = useState(-1);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  /** Forgets the file that was read, so the next one starts clean. */
  function reset() {
    setHeaders([]);
    setRows([]);
    setFileName(null);
    setSenderIdx(-1);
    setStoreIdx(-1);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      // CSV/TSV must be decoded as text (and with the right separator); the binary formats are read
      // straight from the bytes. `accept` already offers both, so a picked file always lands here.
      let wb: XLSX.WorkBook;
      if (isDelimitedFile(file.name)) {
        const text = decodeSpreadsheetText(new Uint8Array(await file.arrayBuffer()));
        wb = XLSX.read(text, { type: "string", FS: guessDelimiter(text, file.name) });
      } else {
        wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      }
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });
      if (matrix.length < 2) throw new Error(t("upload.noData"));
      const hdrs = (matrix[0] as unknown[]).map((h) => String(h));
      const data = matrix
        .slice(1)
        .map((r) => hdrs.map((_, i) => String((r as unknown[])[i] ?? "")));
      setHeaders(hdrs);
      setRows(data);
      setFileName(file.name);
      const guessedSender = guessSenderColumn(hdrs);
      setSenderIdx(guessedSender);
      setStoreIdx(guessStoreColumn(hdrs, guessedSender));
    } catch (err) {
      reset();
      setError(err instanceof Error ? err.message : t("upload.readFailed"));
    }
  }

  async function confirm() {
    if (senderIdx < 0) {
      setError(t("upload.pickPackage"));
      return;
    }
    if (storeIdx < 0) {
      setError(t("upload.pickStore"));
      return;
    }
    if (storeIdx === senderIdx) {
      setError(t("upload.sameColumn"));
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
        storeColumn: storeIdx,
        rows,
      });
      // Rows with no package ID are left out rather than refused, so say so instead of hiding it.
      const skipped = result.skipped
        ? t(result.skipped === 1 ? "upload.skippedOne" : "upload.skippedOther", {
            count: result.skipped,
          })
        : "";
      setNotice(
        t(result.imported === 1 ? "upload.importedOne" : "upload.importedOther", {
          count: result.imported,
          packageColumn: result.senderColumn.name,
          storeColumn: result.storeColumn.name,
          columns: result.columns.length,
          skipped,
        })
      );
      reset();
      await onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("upload.importFailed"));
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <div className="upload-input">
        <input ref={inputRef} type="file" accept={ACCEPT_ATTRIBUTE} onChange={onFile} />
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      {headers.length > 0 && (
        <>
          <div className="card inline">
            <label>
              {t("upload.choosePackage")}
              <select value={senderIdx} onChange={(e) => setSenderIdx(Number(e.target.value))}>
                {senderIdx < 0 && <option value={-1}>{t("upload.selectColumn")}</option>}
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h || t("upload.columnFallback", { n: i + 1 })}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("upload.chooseStore")}
              <select value={storeIdx} onChange={(e) => setStoreIdx(Number(e.target.value))}>
                {storeIdx < 0 && <option value={-1}>{t("upload.selectColumn")}</option>}
                {headers.map((h, i) => (
                  <option key={i} value={i} disabled={i === senderIdx}>
                    {h || t("upload.columnFallback", { n: i + 1 })}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted">
              {t(rows.length === 1 ? "upload.lineCountOne" : "upload.lineCountOther", {
                count: rows.length,
              })}
            </span>
            <button type="button" onClick={confirm} disabled={importing || senderIdx < 0 || storeIdx < 0 || storeIdx === senderIdx}>
              {importing ? t("upload.importing") : t("upload.confirm")}
            </button>
          </div>

          {senderIdx < 0 && (
            <p className="muted">
              {t("upload.cantTellPackage")}
            </p>
          )}
          {storeIdx < 0 && (
            <p className="muted">
              {t("upload.cantTellStore")}
            </p>
          )}
          {storeIdx >= 0 && storeIdx === senderIdx && (
            <p className="muted">
              {t("upload.sameColumnHint")}
            </p>
          )}

          <h2>{t("upload.preview")}</h2>
          <div className="scroll">
            <table className="grid">
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} className={i === senderIdx ? "hl" : i === storeIdx ? "hl2" : ""}>
                      {h || t("upload.columnFallback", { n: i + 1 })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <td key={ci} className={ci === senderIdx ? "hl" : ci === storeIdx ? "hl2" : ""}>
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
