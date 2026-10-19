import fs from "node:fs";
import path from "node:path";
import express, { Router } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config";
import { pool } from "./db";
import { rateLimit } from "./rateLimit";
import { authRouter } from "./auth";
import { campaignsRouter, customersRouter } from "./campaigns";
import { packagesRouter } from "./packages";
import { returnsRouter } from "./returns";
import { exportRouter } from "./export";
import { adminRouter } from "./admin";
import { adminTranslationsRouter, translationsRouter } from "./translationsRoutes";

// The Express app, exported without listening so tests can mount it on an ephemeral port.
//
// All JSON endpoints live under /api. That keeps the API and the single-page app on ONE origin in
// production (so session cookies stay valid) without their paths colliding — the SPA and the API
// both have a /returns and a /campaigns/:id.

export const app = express();

// Behind Plesk's reverse proxy, so req.ip / protocol reflect the real client.
if (config.isProduction) app.set("trust proxy", 1);

app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

// Security headers. The CSP is deliberately strict (no inline script/style): the SPA is a Vite build
// with external assets only, so nothing needs loosening. `upgrade-insecure-requests` is left off
// because the web server (Plesk) already redirects HTTP -> HTTPS, and enabling it would break a
// plain-HTTP local run of the production build.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        // 'wasm-unsafe-eval' lets the on-device OCR compile its WebAssembly core; it does not allow
        // JavaScript eval. The worker script is same-origin (/tesseract/worker.min.js), with blob:
        // kept for browsers that refuse to start a worker from a URL.
        "script-src": ["'self'", "'wasm-unsafe-eval'"],
        "worker-src": ["'self'", "blob:"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'self'"],
        "upgrade-insecure-requests": null,
      },
    },
    // No ads/analytics on this app, and CORP would block nothing we need here.
    crossOriginEmbedderPolicy: false,
    // includeSubDomains is left off so this cannot break unrelated subdomains on the same domain.
    hsts: { maxAge: 180 * 24 * 60 * 60, includeSubDomains: false, preload: false },
  })
);

// `exposedHeaders` lets the SPA read the export's filename from Content-Disposition.
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  })
);

const health = async (_req: Request, res: Response) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up" });
  } catch {
    res.status(503).json({ ok: false, db: "down" });
  }
};

// Unauthenticated liveness probe, handy for uptime checks.
app.get("/health", health);

const api = Router();
api.get("/health", health);

// A general ceiling for every API call, plus a much stricter bucket for failed auth attempts.
api.use(rateLimit({ name: "api", max: config.rateLimit.apiMax, windowMs: config.rateLimit.apiWindowMs }));
const authLimiter = rateLimit({
  name: "auth",
  max: config.rateLimit.authMax,
  windowMs: config.rateLimit.authWindowMs,
  countOnlyFailures: true,
});
api.use("/auth/login", authLimiter);
api.use("/auth/register", authLimiter);
// Password reset is counted on every request: even a generic 200 sends an email, so success must
// not be free to repeat. The two paths get separate budgets so a retry after a typo cannot exhaust
// the other one.
api.use(
  "/auth/forgot",
  rateLimit({ name: "password-forgot", max: 10, windowMs: 15 * 60_000 })
);
api.use("/auth/reset", rateLimit({ name: "password-reset", max: 10, windowMs: 15 * 60_000 }));

api.use("/auth", authRouter);
api.use("/customers", customersRouter);
api.use("/campaigns", campaignsRouter);
api.use("/campaigns/:campaignId", packagesRouter);
api.use("/campaigns/:campaignId/export", exportRouter);
api.use("/returns", returnsRouter);
// Live translation copy is public: the login screen needs it before there is a session.
api.use("/translations", translationsRouter);
// Mounted before the broad /admin router so its own gate and handlers are the first match.
api.use("/admin/translations", adminTranslationsRouter);
api.use("/admin", adminRouter);
// Unknown API paths stay JSON, so the SPA fallback below never swallows them.
api.use((_req, res) => res.status(404).json({ error: "not found" }));
app.use("/api", api);

// ---- serve the built single-page app (production) ----
const distDir = path.resolve(process.cwd(), "dist");
if (config.serveSpa && fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  // Deep links like /returns or /campaigns/3 must return index.html so client routing takes over.
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

// Central error handler (Express 4 needs 4 args).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const type = (err as { type?: string } | null)?.type;
  // A bad body is the caller's fault, so it must not be reported as a server error.
  if (type === "entity.parse.failed") {
    res.status(400).json({ error: "invalid JSON body" });
    return;
  }
  if (type === "entity.too.large") {
    res.status(413).json({ error: "request body too large" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal error" });
});
