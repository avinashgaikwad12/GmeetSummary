# API (Express + Postgres) → Render

The backend. Connects to Neon Postgres and is consumed by the Angular frontend.

## Run locally

```bash
cd api
npm install
cp .env.example .env      # then paste your Neon DATABASE_URL into .env
npm run dev               # http://localhost:3000
```

Test it: open http://localhost:3000/health → should return `{"status":"ok"}`.

## Endpoints

| Method | Path             | Description                          |
|--------|------------------|--------------------------------------|
| GET    | `/health`        | Health check                         |
| GET    | `/api/summaries` | List all summaries (newest first)    |
| POST   | `/api/summaries` | Create one. Body: `{title, transcript}` |

## Deploy to Render

1. Push this repo to GitHub.
2. On https://render.com → **New** → **Web Service** → connect your GitHub repo.
3. Set **Root Directory** to `api`.
4. **Build Command:** `npm install && npm run build`
5. **Start Command:** `npm start`
6. Under **Environment**, add:
   - `DATABASE_URL` = your Neon connection string
   - `CORS_ORIGIN` = your Vercel URL (e.g. `https://your-app.vercel.app`)
7. Create the service. Render gives you a URL like `https://gmeet-api.onrender.com`.
   You'll put that URL into the frontend's `apiUrl` (see `../webapp`).

> Note: Render's free tier sleeps after inactivity, so the first request after
> idle can take ~30s to wake up.
