# GmeetSummary

A simple webapp to summarize Google Meet sessions, built as three components in
one repository (monorepo):

```
GmeetSummary/
├── webapp/     Angular frontend   → deployed on Vercel
├── api/        Express + TS API   → deployed on Render
├── database/   Postgres schema    → runs on Neon
├── render.yaml Render blueprint (optional)
└── README.md
```

## How the pieces connect

```
 Browser → Vercel (Angular) → Render (Express API) → Neon (Postgres)
```

- **GitHub** holds all the code. Vercel and Render watch this repo and
  auto-deploy whenever you `git push`.
- **Neon** is the managed database — you create it once and store its
  connection string as a secret in Render (never in Git).
- The **frontend** knows the API's URL via an environment file; the **API**
  knows the database URL via the `DATABASE_URL` env var on Render.

## Deploy order (do it once, top to bottom)

1. **Database (Neon)** — create the project, run `database/schema.sql`, copy the
   connection string. See [`database/README.md`](./database/README.md).
2. **API (Render)** — deploy the `api/` folder, set `DATABASE_URL` and
   `CORS_ORIGIN`. See [`api/README.md`](./api/README.md). Note its public URL.
3. **Frontend (Vercel)** — deploy the `webapp/` folder, point its `apiUrl` at
   the Render URL from step 2. See [`webapp/README.md`](./webapp/README.md).

After step 3, go back to Render and set `CORS_ORIGIN` to your Vercel URL so the
browser is allowed to call the API.

## Run everything locally

```bash
# Terminal 1 — API
cd api && npm install && cp .env.example .env   # paste Neon URL into .env
npm run dev                                       # http://localhost:3000

# Terminal 2 — frontend
cd webapp && npm install && npm start             # http://localhost:4200
```

## Day-to-day workflow

1. Edit code locally and test with the two commands above.
2. `git add . && git commit -m "..." && git push`.
3. Vercel and Render each detect the push and redeploy automatically.
