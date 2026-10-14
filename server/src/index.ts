import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config";
import { pool } from "./db";

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

// Auth routes (register / login / logout / me) are added in Task 3b.

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
