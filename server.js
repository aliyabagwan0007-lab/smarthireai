import express from "express";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = "smart_hire_session";

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const configuredDbPath = process.env.DB_PATH || "./data/smarthire.sqlite";
const dbPath = path.isAbsolute(configuredDbPath) ? configuredDbPath : path.join(__dirname, configuredDbPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

async function createDatabase() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const sqlite = new DatabaseSync(dbPath);
    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        candidate_name TEXT,
        job_role TEXT,
        match_score INTEGER,
        ats_score INTEGER,
        analysis_json TEXT NOT NULL,
        resume_json TEXT NOT NULL,
        resume_html TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_analyses_user_created ON analyses(user_id, created_at DESC);
    `);
    return {
      kind: "SQLite",
      path: dbPath,
      getUserByEmail(email) { return sqlite.prepare("SELECT * FROM users WHERE email = ?").get(email); },
      getPublicUserById(id) { return sqlite.prepare("SELECT id, name, email, created_at FROM users WHERE id = ?").get(id); },
      createUser(user) {
        const result = sqlite.prepare("INSERT INTO users (name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)").run(user.name, user.email, user.passwordHash, user.passwordSalt, user.createdAt);
        return Number(result.lastInsertRowid);
      },
      insertSession(session) { sqlite.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(session.tokenHash, session.userId, session.createdAt, session.expiresAt); },
      getSession(tokenHash) { return sqlite.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash); },
      deleteSession(tokenHash) { sqlite.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash); },
      insertAnalysis(record) {
        const result = sqlite.prepare(`
          INSERT INTO analyses (user_id, candidate_name, job_role, match_score, ats_score, analysis_json, resume_json, resume_html, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(record.userId, record.candidateName, record.jobRole, record.matchScore, record.atsScore, record.analysisJson, record.resumeJson, record.resumeHtml, record.createdAt);
        return Number(result.lastInsertRowid);
      },
      listAnalyses(userId) {
        return sqlite.prepare(`
          SELECT id, candidate_name AS candidateName, job_role AS jobRole, match_score AS matchScore,
                 ats_score AS atsScore, created_at AS createdAt
          FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
        `).all(userId);
      },
      getAnalysis(id, userId) { return sqlite.prepare("SELECT * FROM analyses WHERE id = ? AND user_id = ?").get(id, userId); },
      deleteAnalysis(id, userId) {
        const result = sqlite.prepare("DELETE FROM analyses WHERE id = ? AND user_id = ?").run(id, userId);
        return result.changes > 0;
      }
    };
  } catch (error) {
    const jsonPath = dbPath.replace(/\.sqlite$/i, ".json");
    let data = { users: [], sessions: [], analyses: [], counters: { users: 1, analyses: 1 } };
    if (fs.existsSync(jsonPath)) {
      try { data = JSON.parse(fs.readFileSync(jsonPath, "utf8")); } catch {}
    }
    const save = () => fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    return {
      kind: "JSON file database",
      path: jsonPath,
      getUserByEmail(email) { return data.users.find((u) => u.email === email) || null; },
      getPublicUserById(id) {
        const u = data.users.find((user) => Number(user.id) === Number(id));
        return u ? { id: u.id, name: u.name, email: u.email, created_at: u.created_at } : null;
      },
      createUser(user) {
        const id = data.counters.users++;
        data.users.push({ id, name: user.name, email: user.email, password_hash: user.passwordHash, password_salt: user.passwordSalt, created_at: user.createdAt });
        save();
        return id;
      },
      insertSession(session) {
        data.sessions.push({ token_hash: session.tokenHash, user_id: session.userId, created_at: session.createdAt, expires_at: session.expiresAt });
        save();
      },
      getSession(tokenHash) { return data.sessions.find((s) => s.token_hash === tokenHash) || null; },
      deleteSession(tokenHash) { data.sessions = data.sessions.filter((s) => s.token_hash !== tokenHash); save(); },
      insertAnalysis(record) {
        const id = data.counters.analyses++;
        data.analyses.push({
          id, user_id: record.userId, candidate_name: record.candidateName, job_role: record.jobRole,
          match_score: record.matchScore, ats_score: record.atsScore, analysis_json: record.analysisJson,
          resume_json: record.resumeJson, resume_html: record.resumeHtml, created_at: record.createdAt
        });
        save();
        return id;
      },
      listAnalyses(userId) {
        return data.analyses
          .filter((a) => Number(a.user_id) === Number(userId))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, 20)
          .map((a) => ({ id: a.id, candidateName: a.candidate_name, jobRole: a.job_role, matchScore: a.match_score, atsScore: a.ats_score, createdAt: a.created_at }));
      },
      getAnalysis(id, userId) { return data.analyses.find((a) => Number(a.id) === Number(id) && Number(a.user_id) === Number(userId)) || null; },
      deleteAnalysis(id, userId) {
        const before = data.analyses.length;
        data.analyses = data.analyses.filter((a) => !(Number(a.id) === Number(id) && Number(a.user_id) === Number(userId)));
        if (data.analyses.length === before) return false;
        save();
        return true;
      }
    };
  }
}

const store = await createDatabase();

const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "3mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false
});

const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false
});

const skillBank = [
  "python", "java", "javascript", "typescript", "c++", "c#", "sql", "html", "css", "react", "node.js", "express",
  "flask", "django", "streamlit", "fastapi", "mongodb", "mysql", "postgresql", "firebase", "aws", "azure", "gcp",
  "git", "github", "docker", "kubernetes", "linux", "rest api", "api", "machine learning", "deep learning",
  "nlp", "natural language processing", "computer vision", "data science", "data analysis", "data visualization",
  "pandas", "numpy", "scikit-learn", "sklearn", "tensorflow", "pytorch", "keras", "matplotlib", "seaborn", "power bi",
  "tableau", "excel", "statistics", "probability", "linear regression", "logistic regression", "decision tree",
  "random forest", "xgboost", "classification", "regression", "clustering", "feature engineering", "model evaluation",
  "transformers", "llm", "prompt engineering", "rag", "vector database", "langchain", "hugging face", "opencv",
  "communication", "teamwork", "leadership", "problem solving", "critical thinking", "presentation", "agile"
];

const impactWords = [
  "built", "created", "developed", "designed", "implemented", "deployed", "optimized", "improved", "automated",
  "reduced", "increased", "integrated", "analyzed", "trained", "evaluated", "published", "launched"
];

function cleanText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function words(text = "") {
  return cleanText(text.toLowerCase())
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeEmail(email = "") {
  return cleanText(email).toLowerCase();
}

function now() {
  return Date.now();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const createdAt = now();
  const expiresAt = createdAt + SESSION_MS;
  store.insertSession({ tokenHash, userId, createdAt, expiresAt });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MS,
    path: "/"
  });
}

function clearSession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    store.deleteSession(hashToken(token));
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

function getAuthedUser(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = store.getSession(tokenHash);
  if (!session || session.expires_at < now()) {
    if (session) store.deleteSession(tokenHash);
    return null;
  }
  const user = store.getPublicUserById(session.user_id);
  return user || null;
}

function requireAuth(req, res, next) {
  const user = getAuthedUser(req);
  if (!user) return res.status(401).json({ error: "Please sign in first." });
  req.user = user;
  next();
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function extractSkills(text = "") {
  const normalized = ` ${cleanText(text.toLowerCase()).replace(/\s+/g, " ")} `;
  return skillBank.filter((skill) => {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, "i");
    return pattern.test(normalized);
  });
}

function topKeywords(text = "", limit = 18) {
  const stop = new Set([
    "and", "the", "for", "with", "you", "your", "are", "our", "will", "this", "that", "from", "have", "has",
    "using", "use", "can", "job", "role", "work", "team", "skill", "skills", "experience", "candidate", "resume",
    "project", "projects", "ability", "knowledge", "good", "strong", "basic", "required", "preferred", "responsibilities",
    "intern", "internship", "company", "description", "looking", "build", "create", "candidate"
  ]);
  const counts = new Map();
  for (const token of words(text)) {
    if (token.length < 3 || stop.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word]) => word);
}

function jaccardScore(aText, bText) {
  const a = new Set(topKeywords(aText, 70));
  const b = new Set(topKeywords(bText, 70));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function titleCase(str = "") {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1));
}

function guessRole(job = "") {
  const j = job.toLowerCase();
  if (/machine learning|ml engineer|deep learning|model|aiml|ai\/ml|artificial intelligence/.test(j)) return "Machine Learning / AIML Role";
  if (/data analyst|power bi|tableau|excel|dashboard|business intelligence/.test(j)) return "Data Analyst Role";
  if (/frontend|react|ui|javascript|typescript/.test(j)) return "Frontend Developer Role";
  if (/backend|node|api|database|server|express/.test(j)) return "Backend Developer Role";
  if (/full stack|fullstack/.test(j)) return "Full Stack Developer Role";
  return "General Tech Internship Role";
}

function localAnalyze(resumeText, jobText, profile = {}) {
  const resume = cleanText(resumeText);
  const job = cleanText(jobText);
  const resumeSkills = extractSkills(resume);
  const jobSkills = extractSkills(job);
  const matchedSkills = jobSkills.filter((skill) => resumeSkills.includes(skill));
  const missingSkills = jobSkills.filter((skill) => !resumeSkills.includes(skill));
  const keywordOverlap = jaccardScore(resume, job);
  const skillScore = jobSkills.length ? matchedSkills.length / jobSkills.length : 0.45;
  const hasMetrics = /\b\d+%|\b\d+x|\b\d+\+|\b\d+\s*(users|records|rows|students|clients|projects|models|apis|seconds|minutes|hours)\b/i.test(resume);
  const hasLinks = /(github|linkedin|portfolio|kaggle|leetcode|huggingface|vercel|netlify)/i.test(resume + " " + Object.values(profile || {}).join(" "));
  const hasProjects = /(project|projects|built|developed|deployed|created|implemented)/i.test(resume);
  const impactCount = impactWords.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(resume)).length;
  const baseMatch = Math.round((skillScore * 68 + keywordOverlap * 22 + Math.min(impactCount, 5) * 2) * 10) / 10;
  const matchScore = Math.max(8, Math.min(96, Math.round(baseMatch)));
  const atsScore = Math.max(20, Math.min(98, Math.round(matchScore * 0.72 + (hasMetrics ? 8 : 0) + (hasLinks ? 7 : 0) + (hasProjects ? 8 : 0) + 8)));
  const missingKeywords = topKeywords(job, 18).filter((kw) => !resume.toLowerCase().includes(kw)).slice(0, 10);
  const recommendedKeywords = [...new Set([...missingSkills, ...missingKeywords])].slice(0, 12);
  const currentResumeStrengths = [];
  if (matchedSkills.length) currentResumeStrengths.push(`Relevant technical skills found: ${matchedSkills.slice(0, 8).map(titleCase).join(", ")}.`);
  if (hasProjects) currentResumeStrengths.push("Project experience is visible and can be improved into stronger achievement bullets.");
  if (hasMetrics) currentResumeStrengths.push("Resume already contains measurable numbers, which is good for ATS and recruiters.");
  if (hasLinks) currentResumeStrengths.push("Professional proof links are present, which improves credibility.");
  if (!currentResumeStrengths.length) currentResumeStrengths.push("Basic resume content is present, but it needs stronger skills, projects, and measurable results.");
  const resumeGaps = [];
  if (!hasMetrics) resumeGaps.push("Add measurable impact such as accuracy, users, records processed, time saved, or model performance.");
  if (!hasLinks) resumeGaps.push("Add GitHub, LinkedIn, portfolio, Kaggle, or deployment links.");
  if (!hasProjects) resumeGaps.push("Add project bullets with tools, result, and a practical problem solved.");
  if (resume.length < 700) resumeGaps.push("Resume is short; add education, skills, projects, internships, certifications, and achievements.");
  if (missingSkills.length) resumeGaps.push(`Missing job keywords: ${missingSkills.slice(0, 7).map(titleCase).join(", ")}.`);
  const improvementPlan = missingSkills.slice(0, 6).map((skill) => `Add one truthful bullet or project point showing practical use of ${titleCase(skill)}.`);
  if (improvementPlan.length < 5) {
    improvementPlan.push("Rewrite bullets with: action verb + technology + result + proof.");
    improvementPlan.push("Move the most job-relevant skills to the first line of the skills section.");
    improvementPlan.push("Keep the final resume black-and-white, one column, and ATS readable.");
  }
  const analysis = {
    source: "Local secure fallback",
    model: "local keyword + similarity engine",
    jobRoleGuess: guessRole(job),
    matchScore,
    atsScore,
    confidence: Math.max(58, Math.min(94, Math.round((resume.length + job.length) / 45))),
    strengthLevel: matchScore >= 75 ? "Excellent match" : matchScore >= 55 ? "Good match" : matchScore >= 35 ? "Average match" : "Needs improvement",
    summary: `Resume matches ${matchScore}% of the target role based on skill coverage, keyword overlap, and ATS quality signals.`,
    currentResumeStrengths,
    resumeGaps,
    matchedSkills: matchedSkills.map(titleCase),
    missingSkills: missingSkills.map(titleCase),
    recommendedKeywords: recommendedKeywords.map(titleCase),
    improvementPlan,
    resumeGenerationPrompt: "Create a black-and-white ATS compatible resume using the candidate profile, original resume, job description, current strengths, and missing keyword plan. Improve wording without inventing fake facts. Use one-column sections, strong action bullets, and job-focused keywords."
  };
  return analysis;
}

function buildGroqPrompt(resumeText, jobText, profile, local) {
  return `You are SmartHire AI, a secure ATS resume analyzer and job matching engine.
Analyze the candidate's resume against the job description and build a prompt for Gemini to rewrite the resume.
Return ONLY valid JSON, no markdown, no commentary.

JSON schema:
{
  "jobRoleGuess": "string",
  "matchScore": number,
  "atsScore": number,
  "confidence": number,
  "strengthLevel": "string",
  "summary": "string",
  "currentResumeStrengths": ["string"],
  "resumeGaps": ["string"],
  "matchedSkills": ["string"],
  "missingSkills": ["string"],
  "recommendedKeywords": ["string"],
  "improvementPlan": ["string"],
  "resumeGenerationPrompt": "string"
}

Rules:
- Scores must be integers from 0 to 100.
- Keep every list under 8 items.
- Do not invent achievements, companies, degrees, metrics, or experience.
- currentResumeStrengths must say what is already good in the current resume.
- resumeGaps must say what is weak or missing.
- resumeGenerationPrompt must be detailed and ready to send to Gemini. It must include instructions to create a clean black-and-white, ATS-safe, company-accepted resume.
- Use this local baseline as reference: ${JSON.stringify(local)}

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

RESUME:
${resumeText.slice(0, 12000)}

JOB DESCRIPTION:
${jobText.slice(0, 12000)}`;
}

function safeJsonParse(text) {
  if (!text) return null;
  const raw = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function normalizeArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.filter(Boolean).map((item) => cleanText(item)).filter(Boolean).slice(0, 10);
}

function normalizeAnalysis(ai, fallback) {
  const merged = { ...fallback, ...(ai || {}) };
  for (const key of ["currentResumeStrengths", "resumeGaps", "matchedSkills", "missingSkills", "recommendedKeywords", "improvementPlan"]) {
    merged[key] = normalizeArray(merged[key], fallback[key] || []);
  }
  for (const key of ["matchScore", "atsScore", "confidence"]) {
    const value = Number(merged[key]);
    merged[key] = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : fallback[key];
  }
  merged.source = ai ? "Groq AI" : fallback.source;
  merged.model = ai ? GROQ_MODEL : fallback.model;
  merged.resumeGenerationPrompt = cleanText(merged.resumeGenerationPrompt || fallback.resumeGenerationPrompt);
  return merged;
}

async function analyzeWithGroq(resumeText, jobText, profile, fallback) {
  if (!groq) return normalizeAnalysis(null, fallback);
  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: "You are a strict JSON API. Return only valid JSON with no markdown." },
        { role: "user", content: buildGroqPrompt(resumeText, jobText, profile, fallback) }
      ],
      temperature: 0.2,
      max_completion_tokens: 2200,
      response_format: { type: "json_object" }
    });
    const content = completion.choices?.[0]?.message?.content || "";
    const parsed = safeJsonParse(content);
    return normalizeAnalysis(parsed, fallback);
  } catch (error) {
    console.error("Groq error:", error?.message || error);
    return normalizeAnalysis(null, fallback);
  }
}

function buildGeminiPrompt(resumeText, jobText, profile, analysis) {
  return `SmartHire AI Groq-generated resume task:
${analysis.resumeGenerationPrompt}

Now generate the final improved resume content.
Return ONLY valid JSON, no markdown.

JSON schema:
{
  "fullName": "string",
  "title": "string",
  "contact": {"email":"string", "phone":"string", "location":"string", "linkedin":"string", "github":"string", "portfolio":"string"},
  "summary": "string",
  "skills": ["string"],
  "education": [{"degree":"string", "institution":"string", "dates":"string", "details":"string"}],
  "experience": [{"role":"string", "company":"string", "location":"string", "dates":"string", "bullets":["string"]}],
  "projects": [{"name":"string", "stack":"string", "bullets":["string"]}],
  "certifications": ["string"],
  "achievements": ["string"]
}

Strict rules:
- Create a black-and-white ATS resume, one-column, company-accepted format.
- Do not invent fake companies, fake degrees, fake dates, fake marks, fake links, or fake numbers.
- Improve wording using the user's actual information only.
- If a section is not available, return an empty array or empty string.
- Use strong action verbs and include job keywords naturally.
- Keep bullets concise and professional.
- Make it suitable for an AIML / tech internship if the job description supports that.

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

GROQ ANALYSIS:
${JSON.stringify(analysis, null, 2)}

ORIGINAL RESUME:
${resumeText.slice(0, 12000)}

TARGET JOB DESCRIPTION:
${jobText.slice(0, 12000)}`;
}

async function generateWithGemini(resumeText, jobText, profile, analysis) {
  if (!process.env.GEMINI_API_KEY) {
    return localResumeJson(resumeText, jobText, profile, analysis, "Local resume fallback", "local-template");
  }
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: buildGeminiPrompt(resumeText, jobText, profile, analysis) }] }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 5000,
          responseMimeType: "application/json"
        }
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || "Gemini request failed");
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
    const parsed = safeJsonParse(text);
    if (!parsed) throw new Error("Gemini returned invalid JSON");
    return normalizeResumeJson(parsed, profile, analysis, "Gemini API", GEMINI_MODEL);
  } catch (error) {
    console.error("Gemini error:", error?.message || error);
    return localResumeJson(resumeText, jobText, profile, analysis, "Local resume fallback", "local-template");
  }
}

function firstLine(text = "") {
  return cleanText(String(text).split(/[\r\n]/).find(Boolean) || "");
}

function extractEmail(text = "") {
  return (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [""])[0];
}

function extractPhone(text = "") {
  return (text.match(/(?:\+?\d[\d\s().-]{7,}\d)/) || [""])[0];
}

function localResumeJson(resumeText, _jobText, profile, analysis, source, model) {
  const inferredName = profile.fullName || firstLine(resumeText) || "Candidate Name";
  const email = profile.email || extractEmail(resumeText);
  const phone = profile.phone || extractPhone(resumeText);
  const skills = [...new Set([...(analysis.matchedSkills || []), ...(analysis.recommendedKeywords || []).slice(0, 8)])].slice(0, 16);
  const title = analysis.jobRoleGuess || profile.targetRole || "AI/ML Intern";
  const projectName = title.includes("Data") ? "Data Analytics Dashboard" : title.includes("Frontend") ? "Responsive Web Application" : "AI Resume Analyzer";
  return normalizeResumeJson({
    fullName: inferredName,
    title,
    contact: {
      email,
      phone,
      location: profile.location || "",
      linkedin: profile.linkedin || "",
      github: profile.github || "",
      portfolio: profile.portfolio || ""
    },
    summary: `Motivated ${title} candidate with hands-on skills in ${skills.slice(0, 6).join(", ") || "software development and problem solving"}. Experienced in building practical projects, analyzing requirements, and improving solutions based on target job needs.`,
    skills,
    education: profile.education ? [{ degree: profile.education, institution: "", dates: "", details: "" }] : [],
    experience: [],
    projects: [{
      name: projectName,
      stack: skills.slice(0, 6).join(", "),
      bullets: [
        `Built a practical project aligned with ${title} requirements using relevant tools and clean implementation practices.`,
        `Applied ${skills.slice(0, 4).join(", ") || "technical skills"} to solve a real-world workflow and present clear outputs.`,
        "Improved resume targeting by adding role-specific keywords, structured sections, and ATS-friendly wording."
      ]
    }],
    certifications: profile.certifications ? [profile.certifications] : [],
    achievements: []
  }, profile, analysis, source, model);
}

function normalizeResumeJson(data, profile, analysis, source, model) {
  const contact = data?.contact && typeof data.contact === "object" ? data.contact : {};
  const resume = {
    source,
    model,
    fullName: cleanText(data?.fullName || profile.fullName || "Candidate Name"),
    title: cleanText(data?.title || profile.targetRole || analysis.jobRoleGuess || "AI/ML Intern"),
    contact: {
      email: cleanText(contact.email || profile.email || ""),
      phone: cleanText(contact.phone || profile.phone || ""),
      location: cleanText(contact.location || profile.location || ""),
      linkedin: cleanText(contact.linkedin || profile.linkedin || ""),
      github: cleanText(contact.github || profile.github || ""),
      portfolio: cleanText(contact.portfolio || profile.portfolio || "")
    },
    summary: cleanText(data?.summary || ""),
    skills: normalizeArray(data?.skills || analysis.recommendedKeywords || [], []),
    education: Array.isArray(data?.education) ? data.education.slice(0, 3).map((item) => ({
      degree: cleanText(item?.degree || ""),
      institution: cleanText(item?.institution || ""),
      dates: cleanText(item?.dates || ""),
      details: cleanText(item?.details || "")
    })) : [],
    experience: Array.isArray(data?.experience) ? data.experience.slice(0, 4).map((item) => ({
      role: cleanText(item?.role || ""),
      company: cleanText(item?.company || ""),
      location: cleanText(item?.location || ""),
      dates: cleanText(item?.dates || ""),
      bullets: normalizeArray(item?.bullets || [], []).slice(0, 5)
    })) : [],
    projects: Array.isArray(data?.projects) ? data.projects.slice(0, 5).map((item) => ({
      name: cleanText(item?.name || ""),
      stack: cleanText(item?.stack || ""),
      bullets: normalizeArray(item?.bullets || [], []).slice(0, 5)
    })) : [],
    certifications: normalizeArray(data?.certifications || [], []).slice(0, 6),
    achievements: normalizeArray(data?.achievements || [], []).slice(0, 6)
  };
  return resume;
}

function renderBullets(items = []) {
  if (!items.length) return "";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderResumeHtml(resume) {
  const contactItems = [
    resume.contact?.email,
    resume.contact?.phone,
    resume.contact?.location,
    resume.contact?.linkedin,
    resume.contact?.github,
    resume.contact?.portfolio
  ].filter(Boolean).map(escapeHtml).join(" • ");

  const section = (title, inner) => inner ? `<section class="r-section"><h2>${escapeHtml(title)}</h2>${inner}</section>` : "";

  const educationHtml = (resume.education || []).map((item) => `
    <div class="r-item">
      <div class="r-row"><strong>${escapeHtml(item.degree)}</strong><span>${escapeHtml(item.dates)}</span></div>
      <div class="r-muted">${escapeHtml([item.institution, item.details].filter(Boolean).join(" — "))}</div>
    </div>`).join("");

  const experienceHtml = (resume.experience || []).map((item) => `
    <div class="r-item">
      <div class="r-row"><strong>${escapeHtml(item.role)}</strong><span>${escapeHtml(item.dates)}</span></div>
      <div class="r-muted">${escapeHtml([item.company, item.location].filter(Boolean).join(" — "))}</div>
      ${renderBullets(item.bullets)}
    </div>`).join("");

  const projectHtml = (resume.projects || []).map((item) => `
    <div class="r-item">
      <div class="r-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.stack)}</span></div>
      ${renderBullets(item.bullets)}
    </div>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(resume.fullName)} Resume</title>
<style>
  *{box-sizing:border-box}body{margin:0;background:#f4f4f4;color:#111;font-family:Arial,Helvetica,sans-serif;line-height:1.45}.resume-page{width:min(8.27in,100%);min-height:11.69in;margin:24px auto;background:#fff;padding:.55in;box-shadow:0 20px 60px rgba(0,0,0,.12)}h1{font-size:28px;text-align:center;margin:0 0 4px;letter-spacing:.02em;text-transform:uppercase}.title{text-align:center;font-size:13px;font-weight:700;margin-bottom:5px}.contact{text-align:center;font-size:11px;margin-bottom:18px;color:#222}.r-section{margin-top:14px}.r-section h2{font-size:13px;border-bottom:1.5px solid #111;margin:0 0 7px;padding-bottom:3px;text-transform:uppercase;letter-spacing:.08em}.r-item{margin:8px 0}.r-row{display:flex;justify-content:space-between;gap:16px;font-size:12px}.r-row span{white-space:nowrap}.r-muted{font-size:11px;color:#333;margin-top:1px}.summary,.skills{font-size:12px}.skills{font-weight:600}ul{margin:4px 0 0 18px;padding:0}li{font-size:11.5px;margin:2.5px 0}@media print{body{background:#fff}.resume-page{width:auto;min-height:auto;margin:0;padding:.45in;box-shadow:none}.no-print{display:none}}
</style>
</head>
<body>
<main class="resume-page">
  <h1>${escapeHtml(resume.fullName)}</h1>
  <div class="title">${escapeHtml(resume.title)}</div>
  <div class="contact">${contactItems}</div>
  ${section("Professional Summary", resume.summary ? `<p class="summary">${escapeHtml(resume.summary)}</p>` : "")}
  ${section("Technical Skills", resume.skills?.length ? `<p class="skills">${resume.skills.map(escapeHtml).join(" • ")}</p>` : "")}
  ${section("Education", educationHtml)}
  ${section("Experience", experienceHtml)}
  ${section("Projects", projectHtml)}
  ${section("Certifications", renderBullets(resume.certifications))}
  ${section("Achievements", renderBullets(resume.achievements))}
</main>
</body>
</html>`;
}

app.post("/api/auth/signup", authLimiter, (req, res) => {
  try {
    const name = cleanText(req.body?.name);
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (name.length < 2) return res.status(400).json({ error: "Enter your name." });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    const existing = store.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: "Account already exists. Sign in instead." });
    const { salt, hash } = hashPassword(password);
    const userId = store.createUser({ name, email, passwordHash: hash, passwordSalt: salt, createdAt: now() });
    createSession(res, userId);
    const user = store.getPublicUserById(userId);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    console.error("Signup error:", error?.message || error);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const user = store.getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  createSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const user = getAuthedUser(req);
  res.json({ user: publicUser(user) });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    groqEnabled: Boolean(process.env.GROQ_API_KEY),
    geminiEnabled: Boolean(process.env.GEMINI_API_KEY),
    groqModel: GROQ_MODEL,
    geminiModel: GEMINI_MODEL,
    database: store.kind
  });
});

app.get("/api/history", requireAuth, (req, res) => {
  res.json({ history: store.listAnalyses(req.user.id) });
});

app.get("/api/history/:id", requireAuth, (req, res) => {
  const row = store.getAnalysis(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "Analysis not found." });
  res.json({
    id: row.id,
    analysis: safeJsonParse(row.analysis_json),
    resume: safeJsonParse(row.resume_json),
    resumeHtml: row.resume_html,
    createdAt: row.created_at
  });
});

app.delete("/api/history/:id", requireAuth, (req, res) => {
  const deleted = store.deleteAnalysis(req.params.id, req.user.id);
  if (!deleted) return res.status(404).json({ error: "Saved resume not found." });
  res.json({ ok: true });
});

app.post("/api/analyze-generate", aiLimiter, requireAuth, async (req, res) => {
  try {
    const resumeText = cleanText(req.body?.resumeText);
    const jobText = cleanText(req.body?.jobText);
    const profile = {
      fullName: cleanText(req.body?.profile?.fullName),
      email: cleanText(req.body?.profile?.email),
      phone: cleanText(req.body?.profile?.phone),
      location: cleanText(req.body?.profile?.location),
      linkedin: cleanText(req.body?.profile?.linkedin),
      github: cleanText(req.body?.profile?.github),
      portfolio: cleanText(req.body?.profile?.portfolio),
      targetRole: cleanText(req.body?.profile?.targetRole),
      education: cleanText(req.body?.profile?.education),
      certifications: cleanText(req.body?.profile?.certifications)
    };

    if (!resumeText || !jobText) {
      return res.status(400).json({ error: "Please provide both resume text and job description." });
    }

    const fallback = localAnalyze(resumeText, jobText, profile);
    const analysis = await analyzeWithGroq(resumeText, jobText, profile, fallback);
    const resume = await generateWithGemini(resumeText, jobText, profile, analysis);
    const resumeHtml = renderResumeHtml(resume);

    const analysisId = store.insertAnalysis({
      userId: req.user.id,
      candidateName: resume.fullName || profile.fullName || req.user.name,
      jobRole: analysis.jobRoleGuess,
      matchScore: analysis.matchScore,
      atsScore: analysis.atsScore,
      analysisJson: JSON.stringify(analysis),
      resumeJson: JSON.stringify(resume),
      resumeHtml,
      createdAt: now()
    });

    res.json({
      id: analysisId,
      analysis,
      resume,
      resumeHtml,
      services: {
        groq: Boolean(process.env.GROQ_API_KEY),
        gemini: Boolean(process.env.GEMINI_API_KEY),
        database: store.kind
      }
    });
  } catch (error) {
    console.error("Analyze/generate error:", error?.message || error);
    res.status(500).json({ error: "Resume generation failed. Check your API keys and try again." });
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SmartHire AI Pro V2 listening on port ${PORT}`);
  console.log(`Database: ${store.kind} at ${store.path}`);
  console.log(process.env.GROQ_API_KEY ? `Groq enabled: ${GROQ_MODEL}` : "Groq key missing. Local analysis fallback enabled.");
  console.log(process.env.GEMINI_API_KEY ? `Gemini enabled: ${GEMINI_MODEL}` : "Gemini key missing. Local resume fallback enabled.");
});
