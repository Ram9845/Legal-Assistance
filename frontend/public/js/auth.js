const STORAGE_KEYS = {
  authUser: "legal_assist_auth_user_v1",
  authToken: "legal_assist_auth_token_v1",
};

function saveSession(user, token) {
  localStorage.setItem(STORAGE_KEYS.authUser, JSON.stringify(user));
  localStorage.setItem(STORAGE_KEYS.authToken, token);
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.authUser);
  localStorage.removeItem(STORAGE_KEYS.authToken);
}

function getToken() {
  return localStorage.getItem(STORAGE_KEYS.authToken) || null;
}

function getStatusEl() {
  return document.getElementById("authStatus");
}

function setStatus(message, kind = "") {
  const el = getStatusEl();
  if (!el) return;
  el.className = `auth-status ${kind}`.trim();
  el.textContent = message;
}

async function authRequest(path, body) {
  const res = await fetch(`${window.APP_CONFIG.backendApiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

async function validateSession() {
  const token = getToken();
  if (!token) return false;

  const res = await fetch(`${window.APP_CONFIG.backendApiBase}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return res.ok;
}

async function fetchCurrentUser(token) {
  const res = await fetch(`${window.APP_CONFIG.backendApiBase}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error("Failed to validate oauth session");
  }

  const data = await res.json();
  return data.user;
}

function readOAuthError() {
  const url = new URL(window.location.href);
  return url.searchParams.get("oauthError");
}

async function handleOAuthRedirectToken() {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#token=")) {
    return false;
  }

  const token = decodeURIComponent(hash.slice("#token=".length));
  if (!token) {
    return false;
  }

  try {
    const user = await fetchCurrentUser(token);
    saveSession(user, token);
    window.location.replace("/chat");
    return true;
  } catch (_err) {
    clearSession();
    setStatus("OAuth login failed. Please try again.", "error");
    return false;
  }
}

function initGoogleAuth() {
  const wrap = document.getElementById("googleAuthWrap");
  if (!wrap) return;

  if (!window.APP_CONFIG.googleClientId) {
    wrap.textContent = "Google login is not configured.";
    return;
  }

  if (!window.google || !window.google.accounts || !window.google.accounts.id) {
    wrap.textContent = "Google login script not loaded.";
    return;
  }

  window.google.accounts.id.initialize({
    client_id: window.APP_CONFIG.googleClientId,
    callback: async (response) => {
      try {
        setStatus("Signing in with Google...");
        const data = await authRequest("/api/auth/google", { credential: response.credential });
        saveSession(data.user, data.token);
        setStatus("Google login successful. Redirecting...", "success");
        window.location.href = "/chat";
      } catch (err) {
        setStatus(err.message || "Google login failed.", "error");
      }
    },
  });

  wrap.innerHTML = "";
  window.google.accounts.id.renderButton(wrap, {
    theme: "outline",
    size: "large",
    text: "continue_with",
    shape: "pill",
    width: 280,
  });
}

function initGithubLink() {
  const link = document.getElementById("githubLoginLink");
  if (!link) return;
  link.href = `${window.APP_CONFIG.backendApiBase}/api/auth/github/start`;
}

function initHomePage() {
  validateSession()
    .then((ok) => {
      if (!ok) return;
      const actions = document.querySelector(".hero-actions");
      const nav = document.querySelector(".nav-actions");
      if (!actions || !nav) return;
      actions.innerHTML = '<a class="solid-btn" href="/chat">Open Chat</a>';
      nav.innerHTML = '<a class="solid-btn" href="/chat">Go to Chat</a>';
    })
    .catch(() => {});

  const quickAskForm = document.getElementById("quickAskForm");
  const quickQuestionInput = document.getElementById("quickQuestionInput");
  const quickAskStatus = document.getElementById("quickAskStatus");
  const quickAskAnswer = document.getElementById("quickAskAnswer");

  if (quickAskForm && quickQuestionInput && quickAskStatus && quickAskAnswer) {
    quickAskForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const question = quickQuestionInput.value.trim();
      if (!question) {
        quickAskStatus.textContent = "Please type a question first.";
        quickAskAnswer.classList.add("hidden");
        return;
      }

      quickAskStatus.textContent = "Getting answer...";
      quickAskAnswer.classList.add("hidden");

      try {
        const res = await fetch(`${window.APP_CONFIG.backendApiBase}/api/chat/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: question, attachments: [] }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || `Request failed (${res.status})`);
        }

        quickAskStatus.textContent = "Answer ready.";
        quickAskAnswer.textContent = data.answer || "No answer returned.";
        quickAskAnswer.classList.remove("hidden");
      } catch (err) {
        quickAskStatus.textContent = err.message || "Failed to fetch answer.";
        quickAskAnswer.classList.add("hidden");
      }
    });
  }
}

function initLoginPage() {
  const form = document.getElementById("loginForm");
  if (!form) return;
  const oauthError = readOAuthError();
  if (oauthError) {
    setStatus(`OAuth error: ${oauthError.replaceAll("_", " ")}`, "error");
  }
  initGoogleAuth();
  initGithubLink();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("email")?.value?.trim().toLowerCase() || "";
    const password = document.getElementById("password")?.value || "";

    if (!email || !password) {
      setStatus("Email and password are required.", "error");
      return;
    }

    try {
      setStatus("Signing in...");
      const data = await authRequest("/api/auth/login", { email, password });
      saveSession(data.user, data.token);
      setStatus("Login successful. Redirecting...", "success");
      window.location.href = "/chat";
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
}

function initRegisterPage() {
  const form = document.getElementById("registerForm");
  if (!form) return;
  const oauthError = readOAuthError();
  if (oauthError) {
    setStatus(`OAuth error: ${oauthError.replaceAll("_", " ")}`, "error");
  }
  initGoogleAuth();
  initGithubLink();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("name")?.value?.trim() || "";
    const email = document.getElementById("email")?.value?.trim().toLowerCase() || "";
    const password = document.getElementById("password")?.value || "";

    if (!name || !email || !password) {
      setStatus("Name, email, and password are required.", "error");
      return;
    }

    if (password.length < 6) {
      setStatus("Password must be at least 6 characters.", "error");
      return;
    }

    try {
      setStatus("Creating account...");
      const data = await authRequest("/api/auth/register", { name, email, password });
      saveSession(data.user, data.token);
      setStatus("Registration successful. Redirecting...", "success");
      window.location.href = "/chat";
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
}

async function init() {
  const consumedOAuthToken = await handleOAuthRedirectToken();
  if (consumedOAuthToken) {
    return;
  }

  if (document.getElementById("loginForm")) {
    initLoginPage();
  } else if (document.getElementById("registerForm")) {
    initRegisterPage();
  } else {
    initHomePage();
  }
}

init();
