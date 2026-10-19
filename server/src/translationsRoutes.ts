import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import { requireAuth, requireSuperAdmin } from "./auth";
import {
  loadAdminTranslations,
  loadPublicTranslations,
  updateTranslations,
  type TranslationUpdate,
} from "./translations";

const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// Longest text the editor may store. The longest current sentence is well under this; the limit only
// stops a broken client from filling the table with megabytes.
const MAX_TRANSLATION_LENGTH = 2000;
const MAX_UPDATES = 2000;

/** The live copy every visitor loads — no session needed, because the login screen uses it too. */
export const translationsRouter = Router();
translationsRouter.get(
  "/",
  ah(async (_req, res) => {
    res.json(await loadPublicTranslations());
  })
);

/** The administrator's editor: the same rows plus screen, role and context. */
export const adminTranslationsRouter = Router();
adminTranslationsRouter.use(requireAuth, requireSuperAdmin);

adminTranslationsRouter.get(
  "/",
  ah(async (_req, res) => {
    res.json(await loadAdminTranslations());
  })
);

adminTranslationsRouter.put(
  "/",
  ah(async (req, res) => {
    const body = (req.body ?? {}) as { updates?: unknown };
    if (!Array.isArray(body.updates)) {
      return res.status(400).json({ error: "updates must be an array" });
    }
    if (body.updates.length === 0) {
      return res.status(400).json({ error: "no updates" });
    }
    if (body.updates.length > MAX_UPDATES) {
      return res.status(400).json({ error: "too many updates" });
    }

    const parsed: TranslationUpdate[] = [];
    for (const raw of body.updates) {
      if (!raw || typeof raw !== "object") {
        return res.status(400).json({ error: "each update must be an object" });
      }
      const candidate = raw as { id?: unknown; english?: unknown; spanish?: unknown };
      const id = Number(candidate.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "each update needs a positive id" });
      }
      if (typeof candidate.english !== "string" || candidate.english.trim() === "") {
        return res.status(400).json({ error: "english is required" });
      }
      if (typeof candidate.spanish !== "string") {
        return res.status(400).json({ error: "spanish must be a string" });
      }
      const english = candidate.english.trim();
      const spanish = candidate.spanish.trim();
      if (english.length > MAX_TRANSLATION_LENGTH || spanish.length > MAX_TRANSLATION_LENGTH) {
        return res
          .status(400)
          .json({ error: `texts must be at most ${MAX_TRANSLATION_LENGTH} characters` });
      }
      parsed.push({ id, english, spanish });
    }

    res.json({ updated: await updateTranslations(parsed) });
  })
);
