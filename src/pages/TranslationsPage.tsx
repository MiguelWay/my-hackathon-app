import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "../i18n/I18nContext";
import { SCREEN_LABELS, type TranslationRow } from "../../shared/translations";

type Field = "english" | "spanish";
type Draft = Record<Field, string>;

/**
 * The administrator's translation editor.
 *
 * Every static text is grouped by the screen it belongs to. Both languages are editable: English is
 * the original, Spanish is what the app shows. Saving updates the table and immediately re-reads the
 * live copy, so the switch in the header reflects the change without a reload.
 */
export function TranslationsPage() {
  const { t, language, refresh } = useI18n();
  const [rows, setRows] = useState<TranslationRow[] | null>(null);
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  const [term, setTerm] = useState("");
  const [screenFilter, setScreenFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await api.get<TranslationRow[]>("/admin/translations");
    setRows(list);
    setDraft({});
  }, []);

  useEffect(() => {
    load().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : t("translations.loadFailed"))
    );
  }, [load, t]);

  const screenName = useCallback(
    (screen: string) => SCREEN_LABELS[screen]?.[language] ?? screen,
    [language]
  );

  const screens = useMemo(() => {
    const seen: string[] = [];
    for (const row of rows ?? []) if (!seen.includes(row.screen)) seen.push(row.screen);
    return seen;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (rows ?? []).filter((row) => {
      if (screenFilter && row.screen !== screenFilter) return false;
      if (!needle) return true;
      return [row.key, row.context, row.english, row.spanish, row.screen]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, screenFilter, term]);

  const valueOf = useCallback(
    (row: TranslationRow, field: Field): string => draft[row.id]?.[field] ?? row[field],
    [draft]
  );

  const isDirty = useCallback(
    (row: TranslationRow): boolean =>
      valueOf(row, "english") !== row.english || valueOf(row, "spanish") !== row.spanish,
    [valueOf]
  );

  const dirtyRows = useMemo(() => (rows ?? []).filter(isDirty), [rows, isDirty]);

  function update(row: TranslationRow, field: Field, value: string) {
    setDraft((current) => {
      const next = current[row.id] ?? { english: row.english, spanish: row.spanish };
      return { ...current, [row.id]: { ...next, [field]: value } };
    });
    setNotice(null);
  }

  async function save() {
    if (dirtyRows.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.put("/admin/translations", {
        updates: dirtyRows.map((row) => ({
          id: row.id,
          english: valueOf(row, "english"),
          spanish: valueOf(row, "spanish"),
        })),
      });
      await load();
      await refresh();
      setNotice(t("translations.saved"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("translations.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function roleLabel(role: string): string {
    if (role === "administrator") return t("translations.roleAdministrator");
    if (role === "operator") return t("translations.roleOperator");
    return t("translations.roleAll");
  }

  const visibleScreens = screens.filter((screen) =>
    filtered.some((row) => row.screen === screen)
  );

  return (
    <div>
      <h1>{t("translations.title")}</h1>
      <p className="muted">{t("translations.help")}</p>

      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      <div className="card translation-toolbar">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t("translations.search")}
          aria-label={t("translations.search")}
        />
        <select
          value={screenFilter}
          onChange={(e) => setScreenFilter(e.target.value)}
          aria-label={t("translations.screen")}
        >
          <option value="">{t("translations.allScreens")}</option>
          {screens.map((screen) => (
            <option key={screen} value={screen}>
              {screenName(screen)}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void save()} disabled={saving || dirtyRows.length === 0}>
          {saving ? t("translations.saving") : t("translations.save")}
        </button>
        <span className={dirtyRows.length > 0 ? "translation-unsaved" : "muted"}>
          {dirtyRows.length > 0
            ? `${t("translations.unsaved")} (${dirtyRows.length})`
            : t("translations.noChanges")}
        </span>
        <span className="muted translation-count">
          {t(filtered.length === 1 ? "translations.countOne" : "translations.countOther", {
            count: filtered.length,
          })}
        </span>
      </div>

      {rows === null ? (
        !error && <p className="muted">{t("common.loading")}</p>
      ) : filtered.length === 0 ? (
        <p className="muted">{t("translations.empty")}</p>
      ) : (
        <div className="scroll">
          <table className="grid translations-table">
            <thead>
              <tr>
                <th>{t("translations.role")}</th>
                <th>{t("translations.context")}</th>
                <th>{t("translations.english")}</th>
                <th>{t("translations.spanish")}</th>
              </tr>
            </thead>
            {visibleScreens.map((screen) => {
              const screenRows = filtered.filter((row) => row.screen === screen);
              return (
                <tbody key={screen}>
                  <tr className="translation-screen">
                    <td colSpan={4}>
                      {screenName(screen)}{" "}
                      <span className="muted">({screenRows.length})</span>
                    </td>
                  </tr>
                  {screenRows.map((row) => (
                    <tr key={row.id} className={isDirty(row) ? "translation-row dirty" : "translation-row"}>
                      <td>
                        <span
                          className={`badge ${
                            row.role === "administrator"
                              ? "role-superadmin"
                              : row.role === "operator"
                                ? "role-user"
                                : ""
                          }`}
                        >
                          {roleLabel(row.role)}
                        </span>
                      </td>
                      <td>
                        <span className="translation-context">{row.context}</span>
                        <span className="translation-key">{row.key}</span>
                      </td>
                      <td>
                        <textarea
                          rows={2}
                          value={valueOf(row, "english")}
                          onChange={(e) => update(row, "english", e.target.value)}
                          aria-label={`${t("translations.english")}: ${row.key}`}
                        />
                      </td>
                      <td>
                        <textarea
                          rows={2}
                          value={valueOf(row, "spanish")}
                          onChange={(e) => update(row, "spanish", e.target.value)}
                          aria-label={`${t("translations.spanish")}: ${row.key}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </div>
  );
}
