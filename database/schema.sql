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
