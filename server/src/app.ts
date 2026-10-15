import express from "express";
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
export const app = express();

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

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up" });
  } catch {
    res.status(503).json({ ok: false, db: "down" });
  }
});

app.use("/auth", authRouter);
app.use("/customers", customersRouter);
app.use("/campaigns", campaignsRouter);
app.use("/campaigns/:campaignId", packagesRouter);
app.use("/campaigns/:campaignId/export", exportRouter);
app.use("/returns", returnsRouter);
app.use("/admin", adminRouter);

// Central error handler (Express 4 needs 4 args).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});
