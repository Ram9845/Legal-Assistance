const STORAGE_KEYS = {
  chats: "legal_assist_chats_v1",
  activeChatId: "legal_assist_active_chat_v1",
  theme: "legal_assist_theme_v1",
  authUser: "legal_assist_auth_user_v1",
  authToken: "legal_assist_auth_token_v1",
};

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

function toTimestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

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
      text: "Hi, I can explain legal topics in simple language. Ask anything.",
      createdAt: Date.now(),
      attachments: [],
    });
  }

  state.chats.unshift(chat);
  saveChats();
  return chat;
}

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

function applyAuthState() {
  if (!els.authBtn) return;
  if (state.authUser) {
    els.authBtn.textContent = `Logout (${state.authUser.name})`;
  } else {
    els.authBtn.textContent = "Login";
  }
}

function renderChatList() {
  els.chatList.innerHTML = "";

  state.chats
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach((chat) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `chat-item ${chat.id === state.activeChatId ? "active" : ""}`;
      item.innerHTML = `<div class="title">${escapeHtml(chat.title)}</div><div class="meta">${formatTime(chat.updatedAt)}</div>`;
      item.addEventListener("click", () => {
        state.activeChatId = chat.id;
        state.animateHistoryOnRender = true;
        saveChats();
        renderAll();
      });
      els.chatList.appendChild(item);
    });
}

function renderMessage(message) {
  const wrap = document.createElement("article");
  wrap.className = `message ${message.role}`;

  const text = document.createElement("div");
  if (message.role === "assistant" && message.text === "Thinking...") {
    const typing = document.createElement("span");
    typing.className = "typing-text";
    typing.setAttribute("aria-label", "Assistant is typing");
    typing.innerHTML = 'Thinking<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    text.appendChild(typing);
  } else {
    text.textContent = message.text;
  }
  wrap.appendChild(text);

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
        chip.textContent = `${att.name} (${att.sizeLabel})`;
        attachmentList.appendChild(chip);
      }
    });

    wrap.appendChild(attachmentList);
  }

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.textContent = formatTime(message.createdAt);
  wrap.appendChild(meta);

  return wrap;
}

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

  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  state.animateHistoryOnRender = false;
}

function renderPendingUploads() {
  els.pendingUploads.innerHTML = "";
  state.pendingUploads.forEach((upload, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "attachment-chip";
    chip.textContent = `${upload.name} x`;
    chip.addEventListener("click", () => {
      state.pendingUploads.splice(index, 1);
      renderPendingUploads();
    });
    els.pendingUploads.appendChild(chip);
  });
}

function renderAll() {
  renderChatList();
  renderMessages();
  renderPendingUploads();
  applyAuthState();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resizeInput() {
  els.questionInput.style.height = "auto";
  els.questionInput.style.height = `${Math.min(els.questionInput.scrollHeight, 180)}px`;
}

function setSendingState(isSending) {
  state.isSending = isSending;
  els.sendBtn.disabled = isSending;
  els.sendBtn.classList.toggle("btn-loading", isSending);
  els.sendBtn.textContent = isSending ? "Sending..." : "Send";
}

function bytesToLabel(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

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

function titleFromQuestion(text) {
  const trimmed = text.trim();
  if (!trimmed) return "New legal question";
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}...` : trimmed;
}

function fallbackEasyAnswer(question) {
  return `Simple explanation: ${question}\n\nThis is a general legal explanation, not legal advice. Rules differ by state. If your issue has deadlines, money risk, or court documents, consult a licensed attorney quickly.`;
}

async function getAssistantAnswer(question, attachments) {
  const prompt = attachments.length
    ? `${question}\n\nContext: user attached ${attachments.length} file(s)/image(s).`
    : question;

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
    const res = await fetch(`${window.APP_CONFIG.backendApiBase}/api/chat/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `Explain in simple language: ${prompt}`,
        attachments: attachmentMeta,
        chatId: active?.serverChatId || null,
      }),
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }

    const data = await res.json();
    if (active && data?.chatId) {
      active.serverChatId = data.chatId;
      saveChats();
    }

    if (data && data.answer) {
      return String(data.answer);
    }
  } catch (err) {
    console.warn("Falling back to local response", err);
  }

  return fallbackEasyAnswer(question);
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

async function sendQuestion() {
  if (state.isSending) return;

  const question = els.questionInput.value.trim();
  if (!question && !state.pendingUploads.length) return;

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
    const answer = await getAssistantAnswer(question || "Please review uploaded files.", uploadSnapshot);

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
  }
}

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

function setupEvents() {
  els.newChatBtn.addEventListener("click", () => {
    const chat = createNewChat(true);
    state.activeChatId = chat.id;
    state.animateHistoryOnRender = false;
    saveChats();
    renderAll();
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

  if (els.authBtn) {
    els.authBtn.addEventListener("click", () => {
      if (state.authUser) {
        clearAuthSession();
        renderAll();
        return;
      }
      window.location.href = "/login";
    });
  }
}

async function init() {
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
