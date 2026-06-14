import express from "express";
import cors from "cors";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import Anthropic from "@anthropic-ai/sdk";
import { pool } from "./db";

const app = express();
app.use(express.json());
// Render terminates TLS at a proxy; this lets req.ip reflect the real client.
app.set("trust proxy", true);

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));

// ---- Config ----------------------------------------------------------------

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-insecure-secret-change-me";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const isAdminEmail = (email?: string | null) =>
  !!email && ADMIN_EMAILS.includes(email.toLowerCase());

// Claude is used to turn meeting transcripts into summaries. Optional — if the
// key isn't set the summarize endpoints return a clear 503 instead of crashing.
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const SINGLE_SYSTEM =
  "You are an expert meeting assistant. Turn the raw transcript into a clear, " +
  "skimmable summary in Markdown. Respond with only the summary — no preamble.";

const COMBINED_SYSTEM =
  "You are an expert chief of staff. You are given individual summaries of " +
  "several meetings. Synthesize them into one consolidated cross-meeting " +
  "summary in Markdown. Respond with only the summary — no preamble.";

const singlePrompt = (title: string, transcript: string) =>
  `Meeting title: ${title}\n\nTranscript:\n${transcript}\n\n` +
  "Produce exactly these sections:\n" +
  "## Summary\nA 2–4 sentence overview.\n" +
  "## Key points\n- concise bullets\n" +
  '## Decisions\n- decisions made (or "None")\n' +
  '## Action items\n- owner — task with any due date (or "None")';

const combinedPrompt = (blocks: string) =>
  `Here are summaries from several meetings:\n\n${blocks}\n\n` +
  "Write a consolidated summary with these sections:\n" +
  "## Overview\nA short paragraph across all of them.\n" +
  "## Common themes\n- recurring topics\n" +
  "## Key decisions\n- decisions across the meetings\n" +
  "## Consolidated action items\n- owner — task\n" +
  "## Per-meeting highlights\n- **Meeting** — one line each";

/** Single Claude call that returns the joined text of the response. */
async function summarizeWithClaude(system: string, user: string): Promise<string> {
  if (!anthropic) throw new Error("anthropic_not_configured");
  const message = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system,
    messages: [{ role: "user", content: user }],
  });
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// ---- Auth types & middleware -----------------------------------------------

interface SessionUser {
  email: string;
  name: string | null;
  picture: string | null;
  isAdmin: boolean;
}
interface AuthedRequest extends express.Request {
  user?: SessionUser;
}

function signToken(user: SessionUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "30d" });
}

function requireAuth(
  req: AuthedRequest,
  res: express.Response,
  next: express.NextFunction
) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    req.user = jwt.verify(token, JWT_SECRET) as SessionUser;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired, please sign in again" });
  }
}

function requireAdmin(
  req: AuthedRequest,
  res: express.Response,
  next: express.NextFunction
) {
  requireAuth(req, res, () => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admins only" });
    next();
  });
}

const nullIfEmpty = (v: unknown) =>
  v === "" || v === undefined ? null : v;

// ---- Health ----------------------------------------------------------------

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ---- Auth: Sign in with Google ---------------------------------------------

app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body ?? {};
  if (!credential) return res.status(400).json({ error: "credential is required" });
  if (!GOOGLE_CLIENT_ID)
    return res.status(500).json({ error: "Server is not configured for Google login" });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email)
      return res.status(401).json({ error: "Invalid Google token" });

    const { sub, email, name, picture } = payload;
    const admin = isAdminEmail(email);

    const userResult = await pool.query(
      `INSERT INTO users (google_sub, email, name, picture)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_sub)
       DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture
       RETURNING id, access_enabled`,
      [sub, email, name ?? null, picture ?? null]
    );
    if (!userResult.rows[0].access_enabled && !admin)
      return res
        .status(403)
        .json({ error: "Your access has been disabled by the administrator." });

    const ip = (req.headers["x-forwarded-for"] as string) || req.ip || null;
    await pool.query(
      `INSERT INTO logins (user_id, email, name, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userResult.rows[0].id, email, name ?? null, ip, req.headers["user-agent"] ?? null]
    );

    const user: SessionUser = {
      email,
      name: name ?? null,
      picture: picture ?? null,
      isAdmin: admin,
    };
    res.json({ token: signToken(user), user });
  } catch (err) {
    console.error("Google login failed:", err);
    res.status(401).json({ error: "Invalid Google token" });
  }
});

// Return the current user from the session token (used on app load).
app.get("/api/me", requireAuth, (req: AuthedRequest, res) => res.json(req.user));

// ---- Meetings --------------------------------------------------------------

app.get("/api/meetings", requireAuth, async (req: AuthedRequest, res) => {
  const { status, q } = req.query as { status?: string; q?: string };
  const params: any[] = [req.user!.email];
  let sql =
    "SELECT * FROM meetings WHERE user_email = $1";
  if (status && status !== "all") {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    sql += ` AND (title ILIKE $${params.length} OR attendees ILIKE $${params.length} OR notes ILIKE $${params.length})`;
  }
  sql += " ORDER BY meeting_date DESC NULLS LAST, created_at DESC";
  try {
    res.json((await pool.query(sql, params)).rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch meetings" });
  }
});

app.post("/api/meetings", requireAuth, async (req: AuthedRequest, res) => {
  const { title, meeting_date, attendees, meet_link, notes, status } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: "title is required" });
  try {
    const result = await pool.query(
      `INSERT INTO meetings (user_email, title, meeting_date, attendees, meet_link, notes, summary, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.user!.email,
        title.trim(),
        nullIfEmpty(meeting_date),
        nullIfEmpty(attendees),
        nullIfEmpty(meet_link),
        nullIfEmpty(notes),
        notes ? String(notes).slice(0, 200) : null,
        status || "upcoming",
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create meeting" });
  }
});

app.patch("/api/meetings/:id", requireAuth, async (req: AuthedRequest, res) => {
  const allowed = ["title", "meeting_date", "attendees", "meet_link", "notes", "summary", "transcript", "status", "google_event_id", "rsvp"];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const f of allowed) {
    if (f in req.body) {
      // rsvp is JSONB — store it as JSON text.
      vals.push(f === "rsvp" ? JSON.stringify(req.body[f]) : nullIfEmpty(req.body[f]));
      sets.push(`${f} = $${vals.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ error: "No fields to update" });
  vals.push(Number(req.params.id), req.user!.email);
  try {
    const result = await pool.query(
      `UPDATE meetings SET ${sets.join(", ")}
       WHERE id = $${vals.length - 1} AND user_email = $${vals.length} RETURNING *`,
      vals
    );
    if (!result.rowCount) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update meeting" });
  }
});

app.delete("/api/meetings/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM meetings WHERE id = $1 AND user_email = $2",
      [Number(req.params.id), req.user!.email]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete meeting" });
  }
});

// Turn a meeting transcript into a summary with Claude, then store both and
// mark the meeting completed. The transcript itself is fetched by the frontend
// from the Google Meet API and POSTed here.
app.post("/api/meetings/:id/summarize", requireAuth, async (req: AuthedRequest, res) => {
  if (!anthropic)
    return res
      .status(503)
      .json({ error: "Summaries aren't configured on the server (missing ANTHROPIC_API_KEY)." });

  const transcript = String(req.body?.transcript ?? "").trim();
  if (!transcript) return res.status(400).json({ error: "transcript is required" });

  const id = Number(req.params.id);
  try {
    const owned = await pool.query(
      "SELECT title FROM meetings WHERE id = $1 AND user_email = $2",
      [id, req.user!.email]
    );
    if (!owned.rowCount) return res.status(404).json({ error: "Not found" });

    // Bound the transcript so a very long call can't blow up the request.
    const text = transcript.slice(0, 100_000);
    const summary = await summarizeWithClaude(SINGLE_SYSTEM, singlePrompt(owned.rows[0].title, text));

    if (!summary) return res.status(502).json({ error: "Empty summary from the model." });

    const updated = await pool.query(
      `UPDATE meetings SET summary = $1, transcript = $2, status = 'completed'
       WHERE id = $3 AND user_email = $4 RETURNING *`,
      [summary, text, id, req.user!.email]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    console.error("Summarize failed:", err);
    res.status(502).json({ error: "Could not generate the summary. Please try again." });
  }
});

// ---- Per-occurrence sessions (one Meet conference = one session) ------------
// The same Meet link can host many conferences over time; each becomes its own
// session row so you get an individual transcript + summary per occurrence.

app.get("/api/meetings/:id/sessions", requireAuth, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  try {
    const r = await pool.query(
      `SELECT id, conference_record, started_at, ended_at, transcript, summary, created_at
       FROM meeting_sessions WHERE meeting_id = $1 AND user_email = $2
       ORDER BY ended_at DESC NULLS LAST, id DESC`,
      [id, req.user!.email]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

app.post("/api/meetings/:id/sessions", requireAuth, async (req: AuthedRequest, res) => {
  if (!anthropic)
    return res
      .status(503)
      .json({ error: "Summaries aren't configured on the server (missing ANTHROPIC_API_KEY)." });

  const id = Number(req.params.id);
  const { conference_record, started_at, ended_at } = req.body ?? {};
  const transcript = String(req.body?.transcript ?? "").trim();
  if (!conference_record || !transcript)
    return res.status(400).json({ error: "conference_record and transcript are required" });

  try {
    const owned = await pool.query(
      "SELECT title FROM meetings WHERE id = $1 AND user_email = $2",
      [id, req.user!.email]
    );
    if (!owned.rowCount) return res.status(404).json({ error: "Not found" });

    const text = transcript.slice(0, 100_000);
    const summary = await summarizeWithClaude(SINGLE_SYSTEM, singlePrompt(owned.rows[0].title, text));
    if (!summary) return res.status(502).json({ error: "Empty summary from the model." });

    const up = await pool.query(
      `INSERT INTO meeting_sessions
         (meeting_id, user_email, conference_record, started_at, ended_at, transcript, summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (meeting_id, conference_record) DO UPDATE SET
         started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at,
         transcript = EXCLUDED.transcript, summary = EXCLUDED.summary
       RETURNING id, conference_record, started_at, ended_at, transcript, summary, created_at`,
      [id, req.user!.email, conference_record, nullIfEmpty(started_at), nullIfEmpty(ended_at), text, summary]
    );

    // Mirror the most recent session onto the meeting row for quick display.
    await pool.query(
      `UPDATE meetings m SET summary = s.summary, transcript = s.transcript, status = 'completed'
       FROM (SELECT summary, transcript FROM meeting_sessions
             WHERE meeting_id = $1 ORDER BY ended_at DESC NULLS LAST, id DESC LIMIT 1) s
       WHERE m.id = $1 AND m.user_email = $2`,
      [id, req.user!.email]
    );

    res.json(up.rows[0]);
  } catch (err) {
    console.error("Add session failed:", err);
    res.status(502).json({ error: "Could not summarize this session." });
  }
});

// ---- Combined summary across several meetings -------------------------------

app.post("/api/meetings/combined-summary", requireAuth, async (req: AuthedRequest, res) => {
  if (!anthropic)
    return res
      .status(503)
      .json({ error: "Summaries aren't configured on the server (missing ANTHROPIC_API_KEY)." });

  const ids: number[] = Array.isArray(req.body?.meeting_ids)
    ? req.body.meeting_ids.map(Number).filter(Number.isInteger)
    : [];
  if (ids.length < 2)
    return res.status(400).json({ error: "Select at least two meetings to combine." });

  try {
    const email = req.user!.email;
    const [meetings, sessions] = await Promise.all([
      pool.query(`SELECT id, title, summary FROM meetings WHERE user_email = $1 AND id = ANY($2::int[])`, [email, ids]),
      pool.query(
        `SELECT meeting_id, summary FROM meeting_sessions
         WHERE user_email = $1 AND meeting_id = ANY($2::int[]) AND summary IS NOT NULL
         ORDER BY ended_at ASC NULLS LAST, id ASC`,
        [email, ids]
      ),
    ]);
    if (!meetings.rowCount) return res.status(404).json({ error: "No meetings found." });

    const byMeeting = new Map<number, string[]>();
    for (const s of sessions.rows) {
      if (!byMeeting.has(s.meeting_id)) byMeeting.set(s.meeting_id, []);
      byMeeting.get(s.meeting_id)!.push(s.summary);
    }

    const blocks: string[] = [];
    for (const m of meetings.rows) {
      const parts = byMeeting.get(m.id) ?? (m.summary ? [m.summary] : []);
      if (parts.length) blocks.push(`## ${m.title}\n${parts.join("\n\n---\n")}`);
    }
    if (!blocks.length)
      return res.status(400).json({ error: "None of the selected meetings have a summary yet." });

    const summary = await summarizeWithClaude(COMBINED_SYSTEM, combinedPrompt(blocks.join("\n\n")));
    if (!summary) return res.status(502).json({ error: "Empty summary from the model." });
    res.json({ summary });
  } catch (err) {
    console.error("Combined summary failed:", err);
    res.status(502).json({ error: "Could not build the combined summary." });
  }
});

// ---- Tasks (action items) --------------------------------------------------

app.get("/api/tasks", requireAuth, async (req: AuthedRequest, res) => {
  const { done, meeting_id } = req.query as { done?: string; meeting_id?: string };
  const params: any[] = [req.user!.email];
  let sql =
    `SELECT t.*, m.title AS meeting_title
     FROM tasks t LEFT JOIN meetings m ON m.id = t.meeting_id
     WHERE t.user_email = $1`;
  if (done === "true" || done === "false") {
    params.push(done === "true");
    sql += ` AND t.done = $${params.length}`;
  }
  if (meeting_id) {
    params.push(Number(meeting_id));
    sql += ` AND t.meeting_id = $${params.length}`;
  }
  sql += " ORDER BY t.done ASC, t.due_date ASC NULLS LAST, t.created_at DESC";
  try {
    res.json((await pool.query(sql, params)).rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

app.post("/api/tasks", requireAuth, async (req: AuthedRequest, res) => {
  const { title, priority, due_date, meeting_id } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: "title is required" });
  try {
    const result = await pool.query(
      `INSERT INTO tasks (user_email, title, priority, due_date, meeting_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        req.user!.email,
        title.trim(),
        priority || "medium",
        nullIfEmpty(due_date),
        nullIfEmpty(meeting_id),
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create task" });
  }
});

app.patch("/api/tasks/:id", requireAuth, async (req: AuthedRequest, res) => {
  const allowed = ["title", "done", "priority", "due_date", "meeting_id"];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const f of allowed) {
    if (f in req.body) {
      vals.push(f === "done" ? !!req.body[f] : nullIfEmpty(req.body[f]));
      sets.push(`${f} = $${vals.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ error: "No fields to update" });
  vals.push(Number(req.params.id), req.user!.email);
  try {
    const result = await pool.query(
      `UPDATE tasks SET ${sets.join(", ")}
       WHERE id = $${vals.length - 1} AND user_email = $${vals.length} RETURNING *`,
      vals
    );
    if (!result.rowCount) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update task" });
  }
});

app.delete("/api/tasks/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM tasks WHERE id = $1 AND user_email = $2",
      [Number(req.params.id), req.user!.email]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// ---- Dashboard stats -------------------------------------------------------

app.get("/api/stats", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const email = req.user!.email;
    const [m, t] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'upcoming')::int AS upcoming,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
         FROM meetings WHERE user_email = $1`,
        [email]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE NOT done)::int AS open,
           COUNT(*) FILTER (WHERE done)::int AS done
         FROM tasks WHERE user_email = $1`,
        [email]
      ),
    ]);
    res.json({ meetings: m.rows[0], tasks: t.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ---- Admin -----------------------------------------------------------------

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  try {
    res.json(
      (
        await pool.query(
          `SELECT id, email, name, picture, access_enabled, created_at
           FROM users ORDER BY created_at DESC`
        )
      ).rows
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.get("/api/admin/logins", requireAdmin, async (_req, res) => {
  try {
    res.json(
      (
        await pool.query(
          `SELECT id, email, name, ip, user_agent, logged_in_at
           FROM logins ORDER BY logged_in_at DESC LIMIT 500`
        )
      ).rows
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch logins" });
  }
});

app.patch("/api/admin/users/:id/access", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { enabled } = req.body ?? {};
  if (!Number.isInteger(id) || typeof enabled !== "boolean")
    return res.status(400).json({ error: "id and boolean 'enabled' are required" });
  try {
    const result = await pool.query(
      `UPDATE users SET access_enabled = $1 WHERE id = $2
       RETURNING id, email, name, picture, access_enabled, created_at`,
      [enabled, id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "User not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update access" });
  }
});

// ---- Start -----------------------------------------------------------------

// Idempotent schema touch-ups so new columns appear without a manual Neon step.
async function ensureSchema() {
  await pool.query("ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript TEXT");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_sessions (
      id SERIAL PRIMARY KEY,
      meeting_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      conference_record TEXT NOT NULL,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      transcript TEXT,
      summary TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (meeting_id, conference_record)
    )
  `);
}

const port = Number(process.env.PORT) || 3000;
ensureSchema()
  .catch((err) => console.error("Schema check failed (continuing):", err.message))
  .finally(() =>
    app.listen(port, "0.0.0.0", () => console.log(`API listening on 0.0.0.0:${port}`))
  );
