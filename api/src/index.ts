import express from "express";
import cors from "cors";
import { OAuth2Client } from "google-auth-library";
import { pool } from "./db";

const app = express();
app.use(express.json());
// Render terminates TLS at a proxy; this lets req.ip reflect the real client.
app.set("trust proxy", true);

// Used to verify Google ID tokens. The GOOGLE_CLIENT_ID env var must match the
// OAuth client used by the frontend (it's the token's expected "audience").
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

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

// Sign in with Google. Body: { credential } where credential is the Google
// ID token (JWT) produced by Google Identity Services in the browser.
// On success: verify the token, upsert the user, record the login, return the
// user's profile.
app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body ?? {};
  if (!credential) {
    return res.status(400).json({ error: "credential (Google ID token) is required" });
  }
  if (!GOOGLE_CLIENT_ID) {
    console.error("GOOGLE_CLIENT_ID is not set on the server.");
    return res.status(500).json({ error: "Server is not configured for Google login" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      return res.status(401).json({ error: "Invalid Google token" });
    }

    const { sub, email, name, picture } = payload;

    // Upsert the user keyed on Google's stable subject id.
    const userResult = await pool.query(
      `INSERT INTO users (google_sub, email, name, picture)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_sub)
       DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture
       RETURNING id`,
      [sub, email, name ?? null, picture ?? null]
    );
    const userId = userResult.rows[0].id;

    // Record this login event in the audit log.
    const ip = (req.headers["x-forwarded-for"] as string) || req.ip || null;
    const userAgent = req.headers["user-agent"] ?? null;
    await pool.query(
      `INSERT INTO logins (user_id, email, name, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, email, name ?? null, ip, userAgent]
    );

    res.json({ email, name, picture });
  } catch (err) {
    console.error("Google login failed:", err);
    res.status(401).json({ error: "Invalid Google token" });
  }
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
