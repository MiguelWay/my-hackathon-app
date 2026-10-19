import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { CampaignListUpload } from "../components/CampaignListUpload";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n/I18nContext";

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
  const { t } = useI18n();
  const isSuperAdmin = user?.role === "superadmin";

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCampaign(await api.get<Campaign>(`/campaigns/${id}`));
  }, [id]);

  useEffect(() => {
    load().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : t("campaignDetail.loadFailed"))
    );
  }, [load]);

  return (
    <div>
      <p>
        <Link to="/">{t("campaignDetail.back")}</Link>
      </p>
      <h1>
        {campaign ? campaign.name : t("campaignDetail.heading", { id: String(id ?? "") })}
      </h1>
      {campaign && (
        <p className="muted">
          {t("campaignDetail.window", {
            start: campaign.start_date ?? "—",
            finish: campaign.finish_date ?? "—",
          })}
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {isSuperAdmin ? (
        <details className="card">
          <summary>{t("campaignDetail.addList")}</summary>
          <CampaignListUpload campaignId={Number(id)} onImported={load} />
        </details>
      ) : (
        <p className="muted">{t("campaignDetail.onlyAdmin")}</p>
      )}
    </div>
  );
}
