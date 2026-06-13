import express from "express";
import cors from "cors";
import { pool } from "./db";

const app = express();
app.use(express.json());

// Allow the Vercel frontend to call this API from the browser.
// In production, lock this down to your exact Vercel URL via the
// CORS_ORIGIN env var (e.g. https://gmeet-summary.vercel.app).
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? "*",
  })
);

// Health check — Render pings this, and it's handy to confirm the API is up.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// List all summaries, newest first.
app.get("/api/summaries", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, title, transcript, summary, created_at FROM summaries ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch summaries" });
  }
});

// Create a new summary. Body: { title, transcript }
app.post("/api/summaries", async (req, res) => {
  const { title, transcript } = req.body ?? {};
  if (!title || !transcript) {
    return res.status(400).json({ error: "title and transcript are required" });
  }

  // Placeholder "summarization": first ~200 chars. Swap this for a real
  // call to an LLM (e.g. the Claude API) when you're ready.
  const summary = String(transcript).slice(0, 200);

  try {
    const result = await pool.query(
      "INSERT INTO summaries (title, transcript, summary) VALUES ($1, $2, $3) RETURNING id, title, transcript, summary, created_at",
      [title, transcript, summary]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create summary" });
  }
});

// Render provides the PORT env var; default to 3000 for local dev.
const port = Number(process.env.PORT) || 3000;
// Bind to 0.0.0.0 so Render's router/health checks can always reach us
// (the default bind can resolve to IPv6-only and flap out of rotation).
app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on 0.0.0.0:${port}`);
});
