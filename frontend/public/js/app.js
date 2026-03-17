// ─── Storage Keys ─────────────────────────────────────────────────────────────
const STORAGE_KEYS = {
  chats: "legal_assist_chats_v1",
  activeChatId: "legal_assist_active_chat_v1",
  theme: "legal_assist_theme_v1",
  authUser: "legal_assist_auth_user_v1",
  authToken: "legal_assist_auth_token_v1",
};

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  chats: [],
  activeChatId: null,
  pendingUploads: [],
  theme: "light",
  authMode: "login",
  authUser: null,
  authToken: null,
  isSending: false,
  animateHistoryOnRender: true,
};

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const els = {
  chatList: document.getElementById("chatList"),
  chatTitle: document.getElementById("chatTitle"),
  chatMessages: document.getElementById("chatMessages"),
  questionInput: document.getElementById("questionInput"),
  sendBtn: document.getElementById("sendBtn"),
  fileInput: document.getElementById("fileInput"),
  pendingUploads: document.getElementById("pendingUploads"),
  newChatBtn: document.getElementById("newChatBtn"),
  themeToggle: document.getElementById("themeToggle"),
  authBtn: document.getElementById("authBtn"),
};

// ─── Utilities ────────────────────────────────────────────────────────────────
function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bytesToLabel(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function toTimestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

// ─── Markdown Rendering ───────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (window.marked) {
    try {
      return window.marked.parse(text, { breaks: true, gfm: true });
    } catch (_) {}
  }
  // Fallback: basic formatting
  return escapeHtml(text).replace(/\n/g, "<br>");
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function loadState() {
  const chats = JSON.parse(localStorage.getItem(STORAGE_KEYS.chats) || "[]");
  const activeChatId = localStorage.getItem(STORAGE_KEYS.activeChatId);
  const theme = localStorage.getItem(STORAGE_KEYS.theme) || "light";
  const authUser = JSON.parse(localStorage.getItem(STORAGE_KEYS.authUser) || "null");
  const authToken = localStorage.getItem(STORAGE_KEYS.authToken) || null;

  state.chats = Array.isArray(chats) ? chats : [];
  state.activeChatId = activeChatId;
  state.theme = theme;
  state.authUser = authUser;
  state.authToken = authToken;

  if (!state.chats.length) {
    const chat = createNewChat(true);
    state.activeChatId = chat.id;
  } else if (!state.chats.some((c) => c.id === state.activeChatId)) {
    state.activeChatId = state.chats[0].id;
  }
}

function saveChats() {
  localStorage.setItem(STORAGE_KEYS.chats, JSON.stringify(state.chats));
  localStorage.setItem(STORAGE_KEYS.activeChatId, state.activeChatId || "");
}

function saveTheme() {
  localStorage.setItem(STORAGE_KEYS.theme, state.theme);
}

function saveAuthSession() {
  localStorage.setItem(STORAGE_KEYS.authUser, JSON.stringify(state.authUser));
  if (state.authToken) {
    localStorage.setItem(STORAGE_KEYS.authToken, state.authToken);
  } else {
    localStorage.removeItem(STORAGE_KEYS.authToken);
  }
}

function clearAuthSession() {
  state.authUser = null;
  state.authToken = null;
  saveAuthSession();
}

// ─── Chat Model ───────────────────────────────────────────────────────────────
function getActiveChat() {
  return state.chats.find((chat) => chat.id === state.activeChatId) || null;
}

function createNewChat(withGreeting = false) {
  const chat = {
    id: uid(),
    title: "New legal question",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };

  if (withGreeting) {
    chat.messages.push({
      id: uid(),
      role: "assistant",
      text: "👋 Hi! I can explain legal topics in simple, clear language. Ask me anything — contracts, tenant rights, employment law, family law, and more.",
      createdAt: Date.now(),
      attachments: [],
    });
  }

  state.chats.unshift(chat);
  saveChats();
  return chat;
}

function pushMessage({ role, text, attachments = [] }) {
  const chat = getActiveChat();
  if (!chat) return;

  chat.messages.push({
    id: uid(),
    role,
    text,
    attachments,
    createdAt: Date.now(),
  });

  chat.updatedAt = Date.now();
  if (role === "user") {
    chat.title = titleFromQuestion(text);
  }

  saveChats();
}

function titleFromQuestion(text) {
  const trimmed = text.trim();
  if (!trimmed) return "New legal question";
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}...` : trimmed;
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function setTheme(theme) {
  state.theme = theme;
  document.body.setAttribute("data-theme", theme);
  if (els.themeToggle) {
    const target = theme === "dark" ? "light" : "dark";
    els.themeToggle.setAttribute("aria-label", `Switch to ${target} mode`);
    els.themeToggle.setAttribute("title", `Switch to ${target} mode`);
  }
  saveTheme();
}

// ─── Auth UI ──────────────────────────────────────────────────────────────────
function applyAuthState() {
  if (!els.authBtn) return;
  if (state.authUser) {
    const initials = (state.authUser.name || state.authUser.email || "?")
      .charAt(0)
      .toUpperCase();
    els.authBtn.innerHTML = `<span class="auth-avatar">${initials}</span> Logout`;
  } else {
    els.authBtn.textContent = "Login";
  }
}

// ─── Render Chat List ─────────────────────────────────────────────────────────
function renderChatList() {
  els.chatList.innerHTML = "";

  state.chats
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach((chat) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `chat-item ${chat.id === state.activeChatId ? "active" : ""}`;
      item.innerHTML = `
        <div class="chat-item-icon">💬</div>
        <div class="chat-item-content">
          <div class="title">${escapeHtml(chat.title)}</div>
          <div class="meta">${formatTime(chat.updatedAt)}</div>
        </div>`;
      item.addEventListener("click", () => {
        state.activeChatId = chat.id;
        state.animateHistoryOnRender = true;
        saveChats();
        renderAll();
      });
      els.chatList.appendChild(item);
    });
}

// ─── Copy to Clipboard ────────────────────────────────────────────────────────
function copyText(text) {
  navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  });
}

// ─── Render Single Message ────────────────────────────────────────────────────
function renderMessage(message) {
  const wrap = document.createElement("article");
  wrap.className = `message ${message.role}`;

  // Avatar
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  if (message.role === "assistant") {
    avatar.innerHTML = `<span class="bot-icon">⚖️</span>`;
  } else {
    const initials = state.authUser
      ? (state.authUser.name || "U").charAt(0).toUpperCase()
      : "U";
    avatar.innerHTML = `<span class="user-init">${initials}</span>`;
  }
  wrap.appendChild(avatar);

  // Bubble
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  // Content
  const content = document.createElement("div");
  content.className = "msg-content";

  if (message.role === "assistant" && message.text === "Thinking...") {
    content.innerHTML =
      '<span class="typing-text">Thinking<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>';
  } else if (message.role === "assistant") {
    content.className += " markdown-body";
    content.innerHTML = renderMarkdown(message.text);
  } else {
    content.textContent = message.text;
  }
  bubble.appendChild(content);

  // Attachments
  if (message.attachments && message.attachments.length) {
    const attachmentList = document.createElement("div");
    attachmentList.className = "attachment-list";

    message.attachments.forEach((att) => {
      if (att.kind === "image" && att.previewDataUrl) {
        const img = document.createElement("img");
        img.className = "preview-img";
        img.src = att.previewDataUrl;
        img.alt = att.name;
        attachmentList.appendChild(img);
      } else {
        const chip = document.createElement("span");
        chip.className = "attachment-chip";
        chip.textContent = `📎 ${att.name} (${att.sizeLabel})`;
        attachmentList.appendChild(chip);
      }
    });

    bubble.appendChild(attachmentList);
  }

  // Footer: timestamp + copy button for assistant
  const footer = document.createElement("div");
  footer.className = "msg-footer";

  const meta = document.createElement("span");
  meta.className = "msg-meta";
  meta.textContent = formatTime(message.createdAt);
  footer.appendChild(meta);

  if (message.role === "assistant" && message.text !== "Thinking...") {
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.title = "Copy answer";
    copyBtn.innerHTML = "⧉ Copy";
    copyBtn.addEventListener("click", () => {
      copyText(message.text);
      copyBtn.innerHTML = "✓ Copied!";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.innerHTML = "⧉ Copy";
        copyBtn.classList.remove("copied");
      }, 2000);
    });
    footer.appendChild(copyBtn);
  }

  bubble.appendChild(footer);
  wrap.appendChild(bubble);

  return wrap;
}

// ─── Render Messages ──────────────────────────────────────────────────────────
function renderMessages() {
  const chat = getActiveChat();
  if (!chat) return;

  els.chatTitle.textContent = chat.title;
  els.chatMessages.innerHTML = "";

  const shouldStagger = state.animateHistoryOnRender && chat.messages.length > 1;

  chat.messages.forEach((message, index) => {
    const messageEl = renderMessage(message);
    if (shouldStagger) {
      messageEl.classList.add("history-stagger");
      messageEl.style.setProperty("--stagger-delay", `${Math.min(index * 36, 420)}ms`);
    }
    els.chatMessages.appendChild(messageEl);
  });

  scrollToBottom();
  state.animateHistoryOnRender = false;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  });
}

// ─── Render Pending Uploads ───────────────────────────────────────────────────
function renderPendingUploads() {
  els.pendingUploads.innerHTML = "";
  state.pendingUploads.forEach((upload, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "attachment-chip removable";
    chip.innerHTML = `📎 ${escapeHtml(upload.name)} <span class="remove-x">✕</span>`;
    chip.addEventListener("click", () => {
      state.pendingUploads.splice(index, 1);
      renderPendingUploads();
    });
    els.pendingUploads.appendChild(chip);
  });
}

// ─── Render All ───────────────────────────────────────────────────────────────
function renderAll() {
  renderChatList();
  renderMessages();
  renderPendingUploads();
  applyAuthState();
}

// ─── Input Auto-resize ────────────────────────────────────────────────────────
function resizeInput() {
  const el = els.questionInput;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
}

// ─── Send State ───────────────────────────────────────────────────────────────
function setSendingState(isSending) {
  state.isSending = isSending;
  els.sendBtn.disabled = isSending;
  els.sendBtn.classList.toggle("btn-loading", isSending);
  if (isSending) {
    els.sendBtn.innerHTML = '<span class="spinner"></span>';
  } else {
    els.sendBtn.innerHTML = '<span class="send-icon">➤</span>';
  }
  els.questionInput.disabled = isSending;
}

// ─── File Upload ──────────────────────────────────────────────────────────────
async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleUploadChange(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";

  for (const file of files.slice(0, 5)) {
    const upload = {
      id: uid(),
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      sizeLabel: bytesToLabel(file.size),
      kind: file.type.startsWith("image/") ? "image" : "file",
      previewDataUrl: null,
    };

    if (upload.kind === "image" && file.size <= 2 * 1024 * 1024) {
      try {
        upload.previewDataUrl = await fileToDataUrl(file);
      } catch (err) {
        console.error("Image preview failed", err);
      }
    }

    state.pendingUploads.push(upload);
  }

  renderPendingUploads();
}

// ─── API Call ─────────────────────────────────────────────────────────────────
function fallbackEasyAnswer(question) {
  return `**General legal information for:** ${question}\n\nThis is a general overview and not legal advice. Laws vary by jurisdiction. If your issue involves court filings, deadlines, or significant financial/criminal risk, please consult a licensed attorney promptly.`;
}

async function getAssistantAnswer(question, attachments) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (state.authToken) {
      headers.Authorization = `Bearer ${state.authToken}`;
    }

    const active = getActiveChat();
    const attachmentMeta = attachments.map((att) => ({
      name: att.name,
      type: att.type,
      sizeLabel: att.sizeLabel,
      kind: att.kind,
    }));

    // FIX: Do NOT double-wrap. Send the question directly.
    // The backend controller will add context as needed.
    const res = await fetch(`${window.APP_CONFIG.backendApiBase}/api/chat/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: question,
        attachments: attachmentMeta,
        chatId: active?.serverChatId || null,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || `Server error: ${res.status}`);
    }

    const data = await res.json();
    if (active && data?.chatId) {
      active.serverChatId = data.chatId;
      saveChats();
    }

    if (data && data.answer) {
      return String(data.answer);
    }

    throw new Error("Empty response from server");
  } catch (err) {
    console.warn("Falling back to local response:", err.message);
  }

  return fallbackEasyAnswer(question);
}

// ─── Send Question ────────────────────────────────────────────────────────────
async function sendQuestion() {
  if (state.isSending) return;

  const question = els.questionInput.value.trim();
  if (!question && !state.pendingUploads.length) {
    els.questionInput.focus();
    return;
  }

  setSendingState(true);

  const uploadSnapshot = state.pendingUploads.map((u) => ({ ...u }));
  state.pendingUploads = [];
  renderPendingUploads();

  pushMessage({
    role: "user",
    text: question || "Uploaded files",
    attachments: uploadSnapshot,
  });

  pushMessage({ role: "assistant", text: "Thinking...", attachments: [] });
  renderAll();

  els.questionInput.value = "";
  resizeInput();

  try {
    const answer = await getAssistantAnswer(
      question || "Please review the uploaded files.",
      uploadSnapshot
    );

    const chat = getActiveChat();
    if (!chat) return;
    const last = chat.messages[chat.messages.length - 1];
    if (last && last.role === "assistant" && last.text === "Thinking...") {
      last.text = answer;
      last.createdAt = Date.now();
    } else {
      pushMessage({ role: "assistant", text: answer, attachments: [] });
    }

    chat.updatedAt = Date.now();
    saveChats();
    renderAll();
  } finally {
    setSendingState(false);
    els.questionInput.focus();
  }
}

// ─── Auth Request ─────────────────────────────────────────────────────────────
async function authRequest(path, body, useToken = false) {
  const headers = { "Content-Type": "application/json" };
  if (useToken && state.authToken) {
    headers.Authorization = `Bearer ${state.authToken}`;
  }

  const res = await fetch(`${window.APP_CONFIG.backendApiBase}${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

// ─── Sync Chats from Server ───────────────────────────────────────────────────
async function syncChatsFromServer() {
  if (!state.authToken) return;

  try {
    const data = await authRequest("/api/chat/history", null, true);
    const chats = Array.isArray(data?.chats) ? data.chats : [];

    if (!chats.length) {
      return;
    }

    state.chats = chats.map((chat) => ({
      id: chat.id,
      serverChatId: chat.id,
      title: chat.title || "New legal question",
      createdAt: toTimestamp(chat.createdAt),
      updatedAt: toTimestamp(chat.updatedAt),
      messages: Array.isArray(chat.messages)
        ? chat.messages.map((msg) => ({
            id: uid(),
            role: msg.role === "assistant" ? "assistant" : "user",
            text: msg.text || "",
            attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
            createdAt: toTimestamp(msg.createdAt),
          }))
        : [],
    }));

    state.activeChatId = state.chats[0].id;
    state.animateHistoryOnRender = true;
    saveChats();
  } catch (_err) {
    // Keep local chats if sync fails.
  }
}

// ─── Session Restore ──────────────────────────────────────────────────────────
async function restoreSession() {
  if (!state.authToken) return;

  try {
    const data = await authRequest("/api/auth/me", null, true);
    state.authUser = data.user;
    saveAuthSession();
    await syncChatsFromServer();
  } catch (_err) {
    clearAuthSession();
  }
}

// ─── Event Binding ────────────────────────────────────────────────────────────
function setupEvents() {
  els.newChatBtn.addEventListener("click", () => {
    const chat = createNewChat(true);
    state.activeChatId = chat.id;
    state.animateHistoryOnRender = false;
    saveChats();
    renderAll();
    els.questionInput.focus();
  });

  els.themeToggle.addEventListener("click", () => {
    setTheme(state.theme === "dark" ? "light" : "dark");
  });

  els.fileInput.addEventListener("change", handleUploadChange);
  els.sendBtn.addEventListener("click", sendQuestion);

  els.questionInput.addEventListener("input", resizeInput);
  els.questionInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendQuestion();
    }
  });

  // Sidebar toggle on mobile
  const sidebarToggle = document.getElementById("sidebarToggle");
  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      document.querySelector(".sidebar")?.classList.toggle("open");
    });
  }

  if (els.authBtn) {
    els.authBtn.addEventListener("click", () => {
      if (state.authUser) {
        clearAuthSession();
        state.chats = [];
        const chat = createNewChat(true);
        state.activeChatId = chat.id;
        renderAll();
        return;
      }
      window.location.href = "/login";
    });
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  if (!els.questionInput || !els.sendBtn || !els.fileInput || !els.chatMessages || !els.chatList) {
    console.error("Chat UI did not load correctly. Missing required elements.");
    return;
  }
  loadState();
  setTheme(state.theme);
  setupEvents();
  await restoreSession();
  renderAll();
  resizeInput();
  requestAnimationFrame(() => {
    document.body.classList.add("page-ready");
  });
}

init();
