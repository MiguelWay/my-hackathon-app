import fs from "node:fs";
import path from "node:path";
import express, { Router } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config";
import { pool } from "./db";
import { authRouter } from "./auth";
import { campaignsRouter, customersRouter } from "./campaigns";
import { packagesRouter } from "./packages";
import { returnsRouter } from "./returns";
import { exportRouter } from "./export";
import { adminRouter } from "./admin";

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
api.use("/auth", authRouter);
api.use("/customers", customersRouter);
api.use("/campaigns", campaignsRouter);
api.use("/campaigns/:campaignId", packagesRouter);
api.use("/campaigns/:campaignId/export", exportRouter);
api.use("/returns", returnsRouter);
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
  console.error(err);
  res.status(500).json({ error: "internal error" });
});
