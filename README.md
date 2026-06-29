# SmartHire AI Pro V2

Secure AI Resume Analyzer and Job Match Predictor with:

- Sign in and create account
- SQLite database storage
- Groq AI resume/job analysis
- Groq-generated Gemini resume prompt
- Gemini API final black-and-white ATS resume generation
- Backend-only API keys
- Downloadable resume HTML and print/save-to-PDF option

## Setup

```bash
npm install
copy .env.example .env
npm start
```

Mac/Linux:

```bash
npm install
cp .env.example .env
npm start
```

Open:

```txt
http://<host>:3000
```

## Environment keys

Add your keys in `.env`:

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile

GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

PORT=3000
NODE_ENV=development
SESSION_DAYS=7
DB_PATH=./data/smarthire.sqlite
```

The app still runs with local fallback mode if one API key is missing, but the full AI chain uses both Groq and Gemini keys.

## Security

- API keys are read only by `server.js` from `.env`.
- Passwords are hashed with Node.js `crypto.scryptSync`.
- Login sessions use HttpOnly cookies.
- Saved analysis records are stored in SQLite under `data/smarthire.sqlite`.
- Gemini returns structured JSON; the backend renders sanitized resume HTML.
