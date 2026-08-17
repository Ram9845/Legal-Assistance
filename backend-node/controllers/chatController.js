import ChatSession from "../models/ChatSession.js";
import { askFastApi } from "../services/ragService.js";
import { isMongoAvailable } from "../services/persistenceMode.js";
import {
  appendChatMessages,
  createChat,
  findChatById,
  listChatsByUser,
} from "../services/localDataStore.js";
import pdfParse from "pdf-parse";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

// ── Nvidia Nemotron LLM Client ──
const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
});

// ── Helpers ──

function toAttachmentMeta(items = []) {
  return items.map((att) => ({
    name: att.name || "file",
    type: att.type || "application/octet-stream",
    sizeLabel: att.sizeLabel || "",
    kind: att.kind === "image" ? "image" : "file",
    dataUrl: att.dataUrl || "",
  }));
}

async function extractTextFromDataUrl(dataUrl, fileType) {
  if (!dataUrl) return "";
  try {
    const base64Data = dataUrl.split(",")[1];
    if (!base64Data) return "";
    const buffer = Buffer.from(base64Data, "base64");
    if (fileType === "application/pdf") {
      const data = await pdfParse(buffer);
      return data.text;
    } else if (fileType && fileType.startsWith("text/")) {
      return buffer.toString("utf8");
    }
  } catch (e) {
    console.error("PDF/Text extraction error:", e.message);
  }
  return "";
}

async function loadChatHistory(chatId, userId) {
  if (!chatId) return [];
  try {
    if (isMongoAvailable()) {
      const session = await ChatSession.findOne({ _id: chatId, userId });
      return session?.messages || [];
    }
    const session = await findChatById(chatId, userId);
    return session?.messages || [];
  } catch (_e) {
    return [];
  }
}

async function saveChatMessages({ userId, chatId, normalizedQuery, attachmentMeta, answer }) {
  if (isMongoAvailable()) {
    let session = chatId
      ? await ChatSession.findOne({ _id: chatId, userId })
      : null;

    if (!session) {
      session = new ChatSession({
        userId,
        title: normalizedQuery.length > 56 ? `${normalizedQuery.slice(0, 56)}...` : normalizedQuery,
        messages: [],
      });
    }

    session.messages.push(
      { role: "user", text: normalizedQuery, attachments: attachmentMeta },
      { role: "assistant", text: String(answer), attachments: [] }
    );
    await session.save();
    return String(session._id);
  }

  // Fallback: local JSON store
  let session = chatId ? await findChatById(chatId, userId) : null;

  if (!session) {
    session = await createChat({
      userId,
      title: normalizedQuery.length > 56 ? `${normalizedQuery.slice(0, 56)}...` : normalizedQuery,
    });
  }

  const updated = await appendChatMessages(session.id, userId, [
    { role: "user", text: normalizedQuery, attachments: attachmentMeta },
    { role: "assistant", text: String(answer), attachments: [] },
  ]);
  return updated?.id || session.id;
}


// ══════════════════════════════════════════════════════════════════════════════
// Main Query Handler
// ══════════════════════════════════════════════════════════════════════════════

export async function queryLegalAssistant(req, res) {
  try {
    const { query, attachments = [], chatId } = req.body || {};

    if (!query || !String(query).trim()) {
      return res.status(400).json({ message: "query is required" });
    }

    const normalizedQuery = String(query).trim();
    const attachmentMeta = toAttachmentMeta(attachments);
    const userId = req.user?.sub;

    // ── Step 1: Extract text from uploaded PDF/text files ──
    let extractedText = "";
    for (const att of attachments) {
      if (att.dataUrl) {
        const text = await extractTextFromDataUrl(att.dataUrl, att.type);
        if (text) {
          extractedText += `\n[Document: ${att.name}]\n${text}\n`;
        }
      }
    }

    // ── Step 2: Load previous chat messages for cross-question context ──
    const previousMessages = await loadChatHistory(chatId, userId);

    // ── Step 3: Call FastAPI RAG — match against Supreme Court dataset ──
    const isDefaultQuery =
      normalizedQuery.toLowerCase() === "please review the uploaded files." ||
      normalizedQuery.toLowerCase() === "uploaded files";
    const userQuestion = isDefaultQuery ? "Explain this legal document in detail" : normalizedQuery;

    let ragContext = "";
    let ml_prediction = "General Legal Inquiry";
    let ml_confidence = null;

    try {
      const ragRes = await askFastApi(userQuestion, extractedText);
      if (ragRes.answer) {
        ragContext = ragRes.answer;
      }
      ml_prediction = ragRes.ml_prediction || ml_prediction;
      ml_confidence = ragRes.ml_confidence || ml_confidence;
    } catch (err) {
      console.error("RAG fetch failed:", err.message);
    }

    // ── Step 4: Build LLM prompt with full context ──
    const systemPrompt = `You are an expert Indian Legal AI Assistant. You help users understand Indian law by:
1. Analyzing their legal documents and questions
2. Citing relevant Supreme Court cases and legal provisions
3. Explaining complex legal concepts in simple, easy-to-understand language

Rules:
- Always cite specific sections, acts, or case names when relevant
- If the retrieved context doesn't fully answer the question, say so honestly
- Give practical next steps the user can take
- This is general legal information, NOT legal advice`;

    // Build conversation history for cross-questions
    const messages = [{ role: "system", content: systemPrompt }];

    // Add previous conversation (last 6 messages max to stay within token limits)
    const recentHistory = previousMessages.slice(-6);
    for (const msg of recentHistory) {
      messages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.text || "",
      });
    }

    // Build current user message with all context
    let currentMessage = `USER QUESTION:\n${userQuestion}`;

    if (extractedText) {
      currentMessage += `\n\nUSER UPLOADED DOCUMENT:\n${extractedText.substring(0, 12000)}`;
    }

    if (ragContext) {
      currentMessage += `\n\nRELEVANT SUPREME COURT CONTEXT (from RAG search):\n${ragContext}`;
    }

    currentMessage += `\n\nPlease answer the question based on the above context. Cite relevant cases and laws.`;

    messages.push({ role: "user", content: currentMessage });

    // ── Step 5: Return RAG Context Directly (LLM Disabled) ──
    let finalAnswer = "";
    if (ragContext) {
      finalAnswer = `**Search Method: ChromaDB Vector Search (Supreme Court PDFs)**\n\nHere are the top 5 related judgments matching your query:\n\n${ragContext}`;
    } else {
      finalAnswer = "No related judgments were found in the Supreme Court dataset.";
    }

    // ── Step 6: Save to MongoDB ──
    let savedChatId = null;
    if (userId) {
      savedChatId = await saveChatMessages({
        userId,
        chatId,
        normalizedQuery,
        attachmentMeta,
        answer: finalAnswer,
      });
    }

    return res.status(200).json({
      answer: finalAnswer,
      ml_prediction,
      ml_confidence,
      chatId: savedChatId,
    });
  } catch (error) {
    console.error("queryLegalAssistant error:", error);
    return res.status(500).json({ message: "Failed to process query", error: error.message });
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// Upload & History
// ══════════════════════════════════════════════════════════════════════════════

export async function uploadFiles(req, res) {
  try {
    const files = req.files || [];
    const uploaded = files.map((file) => ({
      name: file.originalname,
      type: file.mimetype || "application/octet-stream",
      size: file.size,
      sizeLabel:
        file.size < 1024
          ? `${file.size}B`
          : file.size < 1024 * 1024
            ? `${Math.round(file.size / 1024)}KB`
            : `${(file.size / (1024 * 1024)).toFixed(1)}MB`,
      kind: (file.mimetype || "").startsWith("image/") ? "image" : "file",
    }));
    return res.status(200).json({ files: uploaded });
  } catch (error) {
    return res.status(500).json({ message: "Upload failed", error: error.message });
  }
}

export async function getMyChatHistory(req, res) {
  try {
    if (isMongoAvailable()) {
      const sessions = await ChatSession.find({ userId: req.user.sub })
        .sort({ updatedAt: -1 })
        .select("title updatedAt createdAt messages");

      const data = sessions.map((s) => ({
        id: String(s._id),
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messages: s.messages,
      }));
      return res.status(200).json({ chats: data });
    }

    const sessions = await listChatsByUser(req.user.sub);
    const data = sessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messages: s.messages || [],
    }));
    return res.status(200).json({ chats: data });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load chat history", error: error.message });
  }
}
