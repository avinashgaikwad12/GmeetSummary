import { Pool } from "pg";

// The connection string comes from Neon and is supplied at runtime via the
// DATABASE_URL environment variable (set in Render's dashboard). It is never
// hard-coded so the secret stays out of Git.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Fail fast with a clear message instead of a confusing runtime error later.
  throw new Error("DATABASE_URL is not set. Add it in Render (Neon connection string).");
}

export const pool = new Pool({
  connectionString,
  // Neon requires SSL. This setting works for Neon's managed certs.
  ssl: { rejectUnauthorized: false },
});
