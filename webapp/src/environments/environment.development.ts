// LOCAL DEV settings (used by `ng serve` / `npm start`).
// Points at the API running locally on port 3000.
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
  // Same Google OAuth Web client ID (add http://localhost:4200 as an
  // authorized JavaScript origin in Google Cloud Console for local dev).
  googleClientId: '669037669775-b3btrdomappds7l8go29pojqgs5gdmo8.apps.googleusercontent.com',
};
