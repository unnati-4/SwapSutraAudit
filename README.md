# SwapSutra

Hyperlocal Book Exchange — swap, rent, sell, or lend books with nearby readers through a warm community for physical book lovers.

## Architecture

- **Frontend:** Vite + React + TypeScript (`src/App.tsx`)
- **Backend:** Google Apps Script (`appsscript.js`), deployed as a Web App
- **Database:** Google Sheets
- **Local dev / API proxy:** Express (`server.ts`), also exposed as Vercel serverless functions under `api/`
- **Sign-in:** an emailed one-time code, or Sign in with Google when `VITE_GOOGLE_CLIENT_ID` (browser) and `GOOGLE_CLIENT_ID` (Apps Script property) are set — see `.env.example`
- **AI feature:** the Quill assistant is powered by the Gemini API (`@google/genai`) in `server.ts`; it degrades gracefully to a fallback message when no key is configured

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install` (or `bun install`)
2. Copy `.env.example` to `.env` and fill in the values it lists (Apps Script URL, JWT secret, etc.). To enable the Quill AI feature, also set `GEMINI_API_KEY`; to enable ISBN cover/metadata lookups, set `GOOGLE_BOOKS_API_KEY`.
3. Run the app:
   `npm run dev`

## Other scripts

- `npm run build` — builds the frontend (Vite) and bundles the server (`dist/server.cjs`)
- `npm start` — runs the built server
- `npm run preview` — previews the built frontend
- `npm run lint` — TypeScript check (`tsc --noEmit`)
