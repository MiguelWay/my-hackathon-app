// The one rule both campaign lists use to decide whether a campaign is closed.
// `finish_date` is a YYYY-MM-DD string or null; a campaign with no finish date is not closed.

export interface CampaignDates {
  finish_date: string | null;
}

/** The machine's local date as YYYY-MM-DD, so the comparison cannot shift by a timezone. */
export function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Closed once its finish date is before today. An upcoming campaign, or one with no finish date, is open. */
export function isClosed(campaign: CampaignDates, todayIso: string): boolean {
  return campaign.finish_date !== null && campaign.finish_date < todayIso;
}
