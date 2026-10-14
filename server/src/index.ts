import express from "express";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config";
import { pool } from "./db";
import { authRouter } from "./auth";
import { campaignsRouter, customersRouter } from "./campaigns";
import { adminRouter } from "./admin";

const app = express();

app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

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
app.use("/admin", adminRouter);

// Central error handler (Express 4 needs 4 args).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
