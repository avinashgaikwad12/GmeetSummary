# Database (Neon Postgres)

The database itself lives in **Neon** — there's nothing to "deploy" here. This
folder just holds the SQL schema so it's versioned in Git alongside the app.

## One-time setup

1. Go to https://neon.tech and create a free project (region close to your Render region).
2. In the Neon dashboard open **SQL Editor**, paste the contents of [`schema.sql`](./schema.sql), and click **Run**.
3. Click **Connect** (or **Connection Details**) and copy the **connection string**.
   It looks like:

   ```
   postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require
   ```

4. You'll paste that string into **Render** as the `DATABASE_URL` environment
   variable (see `../api/README.md`). Never commit it to Git.

## Changing the schema later

Edit `schema.sql` (or add numbered files like `002_add_column.sql`), then re-run
the new statements in Neon's SQL Editor.
