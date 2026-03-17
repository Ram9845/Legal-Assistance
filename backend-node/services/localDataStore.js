import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../data");
const usersPath = path.join(dataDir, "users.json");
const chatsPath = path.join(dataDir, "chats.json");

async function ensureFile(filePath, fallbackValue) {
  try {
    await fs.access(filePath);
  } catch (_err) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(fallbackValue, null, 2));
  }
}

async function readJson(filePath, fallbackValue) {
  await ensureFile(filePath, fallbackValue);
  const raw = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return fallbackValue;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

export function createId() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

export async function findUserByEmail(email) {
  const users = await readJson(usersPath, []);
  return users.find((user) => user.email === email) || null;
}

export async function findUserById(id) {
  const users = await readJson(usersPath, []);
  return users.find((user) => user.id === id) || null;
}

export async function createUser(userInput) {
  const users = await readJson(usersPath, []);
  const createdAt = nowIso();
  const user = {
    id: createId(),
    name: userInput.name,
    email: userInput.email,
    passwordHash: userInput.passwordHash || null,
    provider: userInput.provider || "local",
    googleSub: userInput.googleSub || null,
    githubSub: userInput.githubSub || null,
    createdAt,
    updatedAt: createdAt,
  };
  users.push(user);
  await writeJson(usersPath, users);
  return user;
}

export async function saveUser(userInput) {
  const users = await readJson(usersPath, []);
  const index = users.findIndex((item) => item.id === userInput.id);
  if (index < 0) {
    return null;
  }
  users[index] = {
    ...users[index],
    ...userInput,
    updatedAt: nowIso(),
  };
  await writeJson(usersPath, users);
  return users[index];
}

export async function findChatById(chatId, userId) {
  const chats = await readJson(chatsPath, []);
  return chats.find((chat) => chat.id === chatId && chat.userId === userId) || null;
}

export async function createChat({ userId, title }) {
  const chats = await readJson(chatsPath, []);
  const createdAt = nowIso();
  const chat = {
    id: createId(),
    userId,
    title: title || "New legal question",
    messages: [],
    createdAt,
    updatedAt: createdAt,
  };
  chats.push(chat);
  await writeJson(chatsPath, chats);
  return chat;
}

export async function appendChatMessages(chatId, userId, messages) {
  const chats = await readJson(chatsPath, []);
  const index = chats.findIndex((chat) => chat.id === chatId && chat.userId === userId);
  if (index < 0) {
    return null;
  }
  const normalized = messages.map((message) => ({
    ...message,
    createdAt: nowIso(),
  }));
  chats[index].messages = [...(chats[index].messages || []), ...normalized];
  chats[index].updatedAt = nowIso();
  await writeJson(chatsPath, chats);
  return chats[index];
}

export async function listChatsByUser(userId) {
  const chats = await readJson(chatsPath, []);
  return chats
    .filter((chat) => chat.userId === userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
