import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { CampaignListUpload } from "../components/CampaignListUpload";
import { useAuth } from "../auth/AuthContext";

interface Campaign {
  id: number;
  name: string;
  start_date: string | null;
  finish_date: string | null;
}

/**
 * One campaign: its window, and the way to add a list to it. The lists it holds and the packages it
 * stores are shown on the campaigns screen and in the exported .xlsx, so they are not repeated here.
 */
export function CampaignDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "superadmin";

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCampaign(await api.get<Campaign>(`/campaigns/${id}`));
  }, [id]);

  useEffect(() => {
    load().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Failed to load campaign")
    );
  }, [load]);

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

      {error && <p className="error">{error}</p>}

      {isSuperAdmin ? (
        <details className="card">
          <summary>Add a list to this campaign</summary>
          <CampaignListUpload campaignId={Number(id)} onImported={load} />
        </details>
      ) : (
        <p className="muted">Only a super-admin can upload lists.</p>
      )}
    </div>
  );
}
