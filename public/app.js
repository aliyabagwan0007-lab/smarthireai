const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  latest: null,
  latestResumeHtml: ""
};

const sampleResume = `Aarav Khan
AIML Student | Python Developer | NLP Enthusiast
Email: aarav@example.com | Phone: +91 9876543210
LinkedIn: linkedin.com/in/aarav-ai | GitHub: github.com/aarav-ai

Education
B.Tech Artificial Intelligence and Machine Learning, XYZ Institute of Technology, 2026

Technical Skills
Python, Machine Learning, Deep Learning, Natural Language Processing, Data Analysis, Pandas, NumPy, Scikit-learn, TensorFlow, Flask, Streamlit, Git, GitHub, REST API, Statistics

Projects
AI Resume Analyzer
Built an NLP application that compares resume text with job descriptions using TF-IDF, skill extraction, and similarity scoring. Added match percentage, missing skills, and AI improvement suggestions.

Student Performance Predictor
Developed a machine learning model using Python, Pandas, Scikit-learn, Logistic Regression, and Random Forest to predict student pass/fail outcomes with 87% accuracy.

Customer Review Sentiment Analyzer
Created an NLP sentiment classification system using preprocessing, TF-IDF, and Naive Bayes. Deployed a Flask API for real-time review predictions.

Internship
Data Science Intern - TechLearn Labs
Cleaned datasets, performed feature engineering, trained classification models, and improved report generation time by 35%.

Certifications
Python for Data Science, Machine Learning Basics, Introduction to Artificial Intelligence`;

const sampleJob = `AI/ML Internship - NLP Automation

We are looking for an AIML intern who can build practical machine learning and NLP solutions. The candidate should have strong Python skills and experience with data preprocessing, machine learning algorithms, model evaluation, and deployment.

Required Skills:
Python, Machine Learning, NLP, Data Analysis, Pandas, NumPy, Scikit-learn, Flask or FastAPI, Git, GitHub, REST API, communication, teamwork, problem solving.

Good to Have:
Deep Learning, TensorFlow or PyTorch, Streamlit dashboards, Hugging Face, prompt engineering, LLM integration, and cloud deployment.

Responsibilities:
Build NLP tools, analyze datasets, create ML models, evaluate accuracy, prepare documentation, and collaborate with the development team.`;

function showToast(message, type = "info") {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3000);
}

function showView(name) {
  $("landingView").hidden = name !== "landing";
  $("authView").hidden = name !== "auth";
  $("appView").hidden = name !== "app";
  window.scrollTo({ top: 0, behavior: "instant" });
}

function setAuthMode(mode) {
  const signIn = mode === "signin";
  $("signInForm").hidden = !signIn;
  $("signUpForm").hidden = signIn;
  $("signInTab").classList.toggle("active", signIn);
  $("signUpTab").classList.toggle("active", !signIn);
  $("authMessage").textContent = "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function updateUserUI() {
  if (!state.user) return;
  $("userName").textContent = state.user.name;
  $("userEmail").textContent = state.user.email;
  $("userInitial").textContent = (state.user.name || "U").trim()[0]?.toUpperCase() || "U";
  $("profileEmail").value = $("profileEmail").value || state.user.email;
  $("fullName").value = $("fullName").value || state.user.name;
}

async function checkMe() {
  try {
    const data = await api("/api/auth/me");
    state.user = data.user;
    if (state.user) updateUserUI();
    return state.user;
  } catch {
    state.user = null;
    return null;
  }
}

async function checkHealth() {
  await api("/api/health").catch(() => null);
}

async function startAnalysisFlow() {
  const user = state.user || await checkMe();
  if (!user) {
    setAuthMode("signin");
    showView("auth");
    return;
  }
  updateUserUI();
  showView("app");
  checkHealth();
  loadHistory();
}

function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function updateStats() {
  $("resumeStats").textContent = `${wordCount($("resumeText").value)} words`;
  $("jobStats").textContent = `${wordCount($("jobText").value)} words`;
}

function readFileInto(fileInput, targetTextarea) {
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      targetTextarea.value = String(reader.result || "");
      updateStats();
    };
    reader.readAsText(file);
  });
}

function profilePayload() {
  return {
    fullName: $("fullName").value.trim(),
    email: $("profileEmail").value.trim(),
    phone: $("phone").value.trim(),
    location: $("location").value.trim(),
    linkedin: $("linkedin").value.trim(),
    github: $("github").value.trim(),
    portfolio: $("portfolio").value.trim(),
    targetRole: $("targetRole").value.trim(),
    education: $("education").value.trim(),
    certifications: $("certifications").value.trim()
  };
}

function loadSample() {
  $("fullName").value = "Aarav Khan";
  $("profileEmail").value = "aarav@example.com";
  $("phone").value = "+91 9876543210";
  $("location").value = "Mumbai, India";
  $("linkedin").value = "linkedin.com/in/aarav-ai";
  $("github").value = "github.com/aarav-ai";
  $("portfolio").value = "";
  $("targetRole").value = "AI/ML Intern";
  $("education").value = "B.Tech Artificial Intelligence and Machine Learning, XYZ Institute of Technology, 2026";
  $("certifications").value = "Python for Data Science, Machine Learning Basics";
  $("resumeText").value = sampleResume;
  $("jobText").value = sampleJob;
  updateStats();
  showToast("Sample loaded. Press Build resume when ready.", "success");
}

function clearAll() {
  ["fullName", "profileEmail", "phone", "location", "linkedin", "github", "portfolio", "targetRole", "education", "certifications", "resumeText", "jobText"].forEach((id) => { $(id).value = ""; });
  if (state.user) {
    $("profileEmail").value = state.user.email;
    $("fullName").value = state.user.name;
  }
  $("resultsPanel").hidden = true;
  state.latest = null;
  state.latestResumeHtml = "";
  updateStats();
  resetSteps();
}

function setStep(stepId, mode) {
  const el = $(stepId);
  el.classList.remove("active", "done", "working");
  if (mode) el.classList.add(mode);
}

function resetSteps() {
  setStep("stepInput", "active");
  setStep("stepCheck", "");
  setStep("stepResume", "");
  setStep("stepSaved", "");
}

function setList(id, items, emptyText = "Nothing found") {
  const root = $(id);
  root.innerHTML = "";
  const list = Array.isArray(items) && items.length ? items : [emptyText];
  list.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    root.appendChild(li);
  });
}

function setPills(id, items, emptyText = "Nothing found") {
  const root = $(id);
  root.innerHTML = "";
  const list = Array.isArray(items) && items.length ? items : [emptyText];
  list.forEach((item) => {
    const span = document.createElement("span");
    span.textContent = item;
    root.appendChild(span);
  });
}

function writeResumeFrame(html) {
  $("resumeFrame").srcdoc = html;
}

function animateValue(element, value) {
  const start = performance.now();
  const end = Math.max(0, Math.min(100, Number(value) || 0));
  function tick(now) {
    const t = Math.min(1, (now - start) / 700);
    const eased = 1 - Math.pow(1 - t, 3);
    element.textContent = `${Math.round(end * eased)}%`;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderResult(payload) {
  state.latest = payload;
  state.latestResumeHtml = payload.resumeHtml || "";
  const analysis = payload.analysis || {};

  $("resultsPanel").hidden = false;
  $("matchRing").style.setProperty("--score", analysis.matchScore || 0);
  animateValue($("matchScore"), analysis.matchScore || 0);
  $("strengthLevel").textContent = analysis.strengthLevel || "Analysis complete";
  $("summaryText").textContent = analysis.summary || "Resume analysis complete.";
  $("modelLine").textContent = "Resume analysis complete";
  $("atsScore").textContent = `${analysis.atsScore || 0}%`;
  $("confidenceScore").textContent = `${analysis.confidence || 0}%`;
  $("atsBar").style.width = `${analysis.atsScore || 0}%`;
  $("confidenceBar").style.width = `${analysis.confidence || 0}%`;
  $("roleGuess").textContent = analysis.jobRoleGuess || "Target role";

  setList("strengthsList", analysis.currentResumeStrengths, "No strong points detected yet");
  setList("gapsList", analysis.resumeGaps, "No major gaps detected");
  setList("planList", analysis.improvementPlan, "No plan available");
  setPills("matchedSkills", analysis.matchedSkills, "No matched skills found");
  setPills("missingSkills", analysis.missingSkills, "No missing skills found");
  setPills("recommendedKeywords", analysis.recommendedKeywords, "No extra keywords needed");

  const planPreview = Array.isArray(analysis.improvementPlan) && analysis.improvementPlan.length
    ? analysis.improvementPlan.slice(0, 3).join(" ")
    : "Use the matched keywords, add proof through projects or internships, and keep the resume clear for ATS screening.";
  $("strategyText").textContent = planPreview;
  $("resumeModelLine").textContent = "Ready to download";
  $("savedNote").textContent = `Saved to your resume history as #${payload.id}`;
  writeResumeFrame(state.latestResumeHtml);
  $("resultsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function generateResume() {
  const resumeText = $("resumeText").value.trim();
  const jobText = $("jobText").value.trim();
  if (!resumeText || !jobText) {
    showToast("Paste both resume text and job description first.", "error");
    return;
  }

  resetSteps();
  $("generateBtn").disabled = true;
  $("loadingBox").hidden = false;
  $("resultsPanel").hidden = true;
  $("loadingTitle").textContent = "Checking your resume...";
  $("loadingText").textContent = "Finding strengths, gaps, ATS score, and a clear improvement plan.";
  setStep("stepInput", "done");
  setStep("stepCheck", "working");

  try {
    setTimeout(() => {
      if (!$("loadingBox").hidden) {
        setStep("stepCheck", "done");
        setStep("stepResume", "working");
        $("loadingTitle").textContent = "Writing your ATS resume...";
        $("loadingText").textContent = "Creating a clean resume you can download or print.";
      }
    }, 1300);

    const data = await api("/api/analyze-generate", {
      method: "POST",
      body: JSON.stringify({ resumeText, jobText, profile: profilePayload() })
    });
    setStep("stepCheck", "done");
    setStep("stepResume", "done");
    setStep("stepSaved", "done");
    renderResult(data);
    loadHistory();
    showToast("Resume generated and saved.", "success");
  } catch (error) {
    showToast(error.message || "Generation failed", "error");
    resetSteps();
  } finally {
    $("generateBtn").disabled = false;
    $("loadingBox").hidden = true;
  }
}

async function loadHistory() {
  if (!state.user) return;
  const list = $("historyList");
  try {
    const data = await api("/api/history");
    list.innerHTML = "";
    if (!data.history?.length) {
      list.innerHTML = "<p>No saved resumes yet.</p>";
      return;
    }
    data.history.forEach((item) => {
      const row = document.createElement("div");
      row.className = "history-row";

      const btn = document.createElement("button");
      btn.className = "history-item";

      const title = document.createElement("strong");
      title.textContent = item.candidateName || "Resume";
      const role = document.createElement("span");
      role.textContent = item.jobRole || "Role";
      const meta = document.createElement("small");
      meta.textContent = `${item.matchScore || 0}% match - ${new Date(item.createdAt).toLocaleDateString()}`;

      btn.append(title, role, meta);
      btn.addEventListener("click", async () => {
        try {
          const detail = await api(`/api/history/${item.id}`);
          renderResult({ id: item.id, ...detail });
        } catch (error) {
          showToast(error.message, "error");
        }
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "history-delete";
      deleteBtn.type = "button";
      deleteBtn.textContent = "Delete";
      deleteBtn.title = "Delete saved resume";
      deleteBtn.addEventListener("click", async () => {
        const label = item.candidateName || "this resume";
        if (!confirm(`Delete ${label} from your saved resumes?`)) return;
        try {
          await api(`/api/history/${item.id}`, { method: "DELETE" });
          if (state.latest?.id === item.id) {
            state.latest = null;
            state.latestResumeHtml = "";
            $("resultsPanel").hidden = true;
            resetSteps();
          }
          showToast("Saved resume deleted.", "success");
          loadHistory();
        } catch (error) {
          showToast(error.message, "error");
        }
      });

      row.append(btn, deleteBtn);
      list.appendChild(row);
    });
  } catch (error) {
    list.textContent = error.message;
  }
}

function downloadResumeHtml() {
  if (!state.latestResumeHtml) {
    showToast("Generate a resume first.", "error");
    return;
  }
  const name = (state.latest?.resume?.fullName || "SmartHireAI-Resume").replace(/[^a-z0-9-]+/gi, "-");
  const blob = new Blob([state.latestResumeHtml], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-resume.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printResume() {
  if (!state.latestResumeHtml) {
    showToast("Generate a resume first.", "error");
    return;
  }
  const win = window.open("", "_blank");
  if (!win) {
    showToast("Popup blocked. Use Download HTML instead.", "error");
    return;
  }
  win.document.open();
  win.document.write(state.latestResumeHtml);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

async function logout() {
  await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
  state.user = null;
  state.latest = null;
  state.latestResumeHtml = "";
  showView("landing");
}

function scrollToLandingSection(id) {
  const section = $(id);
  if (!section) return;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("startAnalysisBtn").addEventListener("click", startAnalysisFlow);
$("openSignInTop").addEventListener("click", () => { setAuthMode("signin"); showView("auth"); });
$("openCreateTop").addEventListener("click", () => { setAuthMode("signup"); showView("auth"); });
$("backHome").addEventListener("click", () => showView("landing"));
$("signInTab").addEventListener("click", () => setAuthMode("signin"));
$("signUpTab").addEventListener("click", () => setAuthMode("signup"));
$("navProduct").addEventListener("click", () => scrollToLandingSection("howItWorks"));
$("navSecurity").addEventListener("click", () => scrollToLandingSection("privacySection"));
$("navResume").addEventListener("click", startAnalysisFlow);
$("footerStartBtn").addEventListener("click", startAnalysisFlow);
$("footerHowBtn").addEventListener("click", () => scrollToLandingSection("howItWorks"));
$("footerPrivacyBtn").addEventListener("click", () => scrollToLandingSection("privacySection"));
$("footerSignInBtn").addEventListener("click", () => { setAuthMode("signin"); showView("auth"); });

$("signInForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("authMessage").textContent = "Signing in...";
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("loginEmail").value, password: $("loginPassword").value })
    });
    state.user = data.user;
    updateUserUI();
    showView("app");
    checkHealth();
    loadHistory();
  } catch (error) {
    $("authMessage").textContent = error.message;
  }
});

$("signUpForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("authMessage").textContent = "Creating account...";
  try {
    const data = await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name: $("signupName").value, email: $("signupEmail").value, password: $("signupPassword").value })
    });
    state.user = data.user;
    updateUserUI();
    showView("app");
    checkHealth();
    loadHistory();
  } catch (error) {
    $("authMessage").textContent = error.message;
  }
});

$("resumeText").addEventListener("input", updateStats);
$("jobText").addEventListener("input", updateStats);
readFileInto($("resumeFile"), $("resumeText"));
readFileInto($("jobFile"), $("jobText"));
$("loadSampleBtn").addEventListener("click", loadSample);
$("clearBtn").addEventListener("click", clearAll);
$("generateBtn").addEventListener("click", generateResume);
$("refreshHistory").addEventListener("click", loadHistory);
$("logoutBtn").addEventListener("click", logout);
$("downloadHtmlBtn").addEventListener("click", downloadResumeHtml);
$("printResumeBtn").addEventListener("click", printResume);

(async function init() {
  resetSteps();
  updateStats();
  const user = await checkMe();
  if (user) {
    updateUserUI();
    checkHealth();
  }
})();
