-- GmeetSummary database schema
-- Run this once against your Neon Postgres database.
-- In Neon: open your project -> "SQL Editor" -> paste this -> Run.

CREATE TABLE IF NOT EXISTS summaries (
    id          SERIAL PRIMARY KEY,
    title       TEXT        NOT NULL,
    transcript  TEXT        NOT NULL,
    summary     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful index for listing newest-first.
CREATE INDEX IF NOT EXISTS idx_summaries_created_at
    ON summaries (created_at DESC);

-- ---------------------------------------------------------------------------
-- Authentication: Google sign-in
-- ---------------------------------------------------------------------------

-- One row per Google account that has ever signed in (upserted on each login).
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    google_sub      TEXT        UNIQUE NOT NULL,   -- Google's stable user id ("sub")
    email           TEXT        NOT NULL,
    name            TEXT,
    picture         TEXT,                          -- profile photo URL
    access_enabled  BOOLEAN     NOT NULL DEFAULT true,  -- admin can block login
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per successful login event (the login audit log).
CREATE TABLE IF NOT EXISTS logins (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER     REFERENCES users (id),
    email         TEXT        NOT NULL,
    name          TEXT,
    ip            TEXT,
    user_agent    TEXT,
    logged_in_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logins_logged_in_at
    ON logins (logged_in_at DESC);

-- ---------------------------------------------------------------------------
-- Core app: meetings and their action items (tasks). Scoped per user_email.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meetings (
    id            SERIAL PRIMARY KEY,
    user_email    TEXT        NOT NULL,            -- owner
    title         TEXT        NOT NULL,
    meeting_date  TIMESTAMPTZ,
    attendees     TEXT,                            -- freeform / comma separated
    meet_link     TEXT,                            -- Google Meet URL
    notes         TEXT,
    summary       TEXT,
    status        TEXT        NOT NULL DEFAULT 'upcoming', -- upcoming|completed|cancelled
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meetings_user
    ON meetings (user_email, meeting_date DESC);

CREATE TABLE IF NOT EXISTS tasks (
    id          SERIAL PRIMARY KEY,
    user_email  TEXT        NOT NULL,              -- owner
    meeting_id  INTEGER     REFERENCES meetings (id) ON DELETE SET NULL,
    title       TEXT        NOT NULL,
    done        BOOLEAN     NOT NULL DEFAULT false,
    priority    TEXT        NOT NULL DEFAULT 'medium',  -- low|medium|high
    due_date    DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_user
    ON tasks (user_email, done, due_date);
