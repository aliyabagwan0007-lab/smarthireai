# Deploy SmartHire AI on Render

## 1. Upload to GitHub

1. Create a new GitHub repository.
2. Make sure generated and secret files are not committed:
   - `node_modules`
   - `.env`
   - `.secrets`
   - `*.sqlite`, `*.sqlite-shm`, `*.sqlite-wal`
   - `logs`
3. Commit the project files.
4. Push the repository to GitHub.

## 2. Deploy on Render

1. Open Render and choose **New > Web Service**.
2. Connect the GitHub repository.
3. Render can read `render.yaml` automatically. If configuring manually, use:
   - Environment: `Node`
   - Plan: `Free`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add the environment variables listed below.
5. Deploy the service.

## 3. Environment Variables

Required for AI services:

```env
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

Runtime settings:

```env
NODE_ENV=production
SESSION_DAYS=7
DB_PATH=./data/smarthire.sqlite
```

Do not set `PORT` on Render. Render provides it automatically and the app reads `process.env.PORT`.

## 4. Common Issues

**Build fails during npm install**

Check that `package.json` and `package-lock.json` are committed and that Render is using Node 18 or newer.

**App starts locally but not on Render**

Confirm the start command is `npm start`. The server listens on `0.0.0.0` and uses Render's `PORT`.

**AI responses use fallback mode**

Verify `GROQ_API_KEY` and `GEMINI_API_KEY` are configured in Render. The app continues running without them, but analysis and resume generation use local fallback behavior.

**Database is empty after redeploy**

Render Free web services use ephemeral disk storage. SQLite files can be recreated automatically, but saved users and history may not persist across rebuilds or restarts. For persistent production data, move to a managed database.

**SQLite file is missing**

This is expected on first deploy. The app creates the `data` directory and database file automatically when it starts.
