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
