import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { downloadCampaignExport } from "../lib/campaignExport";
import { CampaignListUpload } from "../components/CampaignListUpload";
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

  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function downloadExport() {
    setError(null);
    setNotice(null);
    setExporting(true);
    try {
      const filename = await downloadCampaignExport(Number(id));
      setNotice(`Exported ${packages.length} packages to ${filename}.`);
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
        <details className="card">
          <summary>Add a list to this campaign</summary>
          <CampaignListUpload campaignId={Number(id)} onImported={load} />
        </details>
      )}

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      <details className="card" open>
        <summary>
          Lists uploaded · {uploads.length} list{uploads.length === 1 ? "" : "s"} · {totalRows} line
          {totalRows === 1 ? "" : "s"}
        </summary>

        {uploads.length === 0 ? (
          <p className="muted">No lists uploaded yet.</p>
        ) : (
          <>
            <ul className="upload-list">
              {uploads.map((u) => (
                <li key={u.id}>
                  <span className="file">{u.filename ?? "unknown file"}</span>
                  <span>{u.row_count} lines</span>
                  <span className="muted">uploaded {u.created_at}</span>
                </li>
              ))}
            </ul>

            <div className="btn-row">
              <button
                type="button"
                className="secondary"
                onClick={downloadExport}
                disabled={exporting || packages.length === 0}
              >
                {exporting ? "Preparing…" : "Download .xlsx"}
              </button>
            </div>
          </>
        )}
      </details>

      <details className="card" open>
        <summary>Campaign results · {packages.length} packages</summary>

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
      </details>
    </div>
  );
}
