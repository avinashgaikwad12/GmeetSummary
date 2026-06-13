# Webapp (Angular) → Vercel

The frontend. Calls the Render API and shows summaries.

## Run locally

```bash
cd webapp
npm install
npm start          # http://localhost:4200
```

Make sure the API is running locally too (`cd ../api && npm run dev`). Local dev
uses `src/environments/environment.development.ts`, which points `apiUrl` at
`http://localhost:3000`.

## Point the build at your API

Before deploying, edit `src/environments/environment.ts` and set `apiUrl` to
your Render URL:

```ts
export const environment = {
  production: true,
  apiUrl: 'https://YOUR-RENDER-SERVICE.onrender.com',
};
```

Commit and push that change.

## Deploy to Vercel

1. Push this repo to GitHub.
2. On https://vercel.com → **Add New** → **Project** → import your GitHub repo.
3. Set **Root Directory** to `webapp`.
4. Vercel auto-detects Angular. The included `vercel.json` already sets:
   - Build command: `npm run build`
   - Output directory: `dist/webapp/browser`
   - SPA rewrites (so refreshing any route serves `index.html`)
5. Click **Deploy**. You get a URL like `https://gmeet-summary.vercel.app`.
6. Go back to **Render** and set `CORS_ORIGIN` to that exact Vercel URL, so the
   browser is allowed to call your API.

Every `git push` to the repo redeploys the site automatically.
