import ChatSession from "../models/ChatSession.js";
import { askFastApi } from "../services/ragService.js";

function toAttachmentMeta(items = []) {
  return items.map((att) => ({
    name: att.name || "file",
    type: att.type || "application/octet-stream",
    sizeLabel: att.sizeLabel || "",
    kind: att.kind === "image" ? "image" : "file",
  }));
}

function fallbackAnswer(question) {
  return `Simple legal explanation: ${question}\n\nThis is general information, not legal advice. Laws vary by state. For deadlines, court filings, or criminal/civil risk, contact a licensed attorney immediately.`;
}

function buildPrompt(question, attachmentCount) {
  const attachmentNote = attachmentCount > 0
    ? `\n\nUser attached ${attachmentCount} file(s)/image(s).`
    : "";

  return `Explain in simple language for a non-lawyer:\n${question}${attachmentNote}`;
}

export async function queryLegalAssistant(req, res) {
  try {
    const { query, attachments = [], chatId } = req.body || {};

    if (!query || !String(query).trim()) {
      return res.status(400).json({ message: "query is required" });
    }

    const normalizedQuery = String(query).trim();
    const attachmentMeta = toAttachmentMeta(attachments);

    let answer;
    try {
      answer = await askFastApi(buildPrompt(normalizedQuery, attachmentMeta.length));
    } catch (_err) {
      answer = fallbackAnswer(normalizedQuery);
    }

    let savedChatId = null;
    if (req.user?.sub) {
      let session = null;

      if (chatId) {
        session = await ChatSession.findOne({ _id: chatId, userId: req.user.sub });
      }

      if (!session) {
        session = new ChatSession({
          userId: req.user.sub,
          title:
            normalizedQuery.length > 56
              ? `${normalizedQuery.slice(0, 56)}...`
              : normalizedQuery,
          messages: [],
        });
      }

      session.messages.push({
        role: "user",
        text: normalizedQuery,
        attachments: attachmentMeta,
      });

      session.messages.push({
        role: "assistant",
        text: String(answer),
        attachments: [],
      });

      await session.save();
      savedChatId = String(session._id);
    }

    return res.status(200).json({
      answer: String(answer),
      chatId: savedChatId,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to process query", error: error.message });
  }
}

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
    const sessions = await ChatSession.find({ userId: req.user.sub })
      .sort({ updatedAt: -1 })
      .select("title updatedAt createdAt messages");

    const data = sessions.map((session) => ({
      id: String(session._id),
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages,
    }));

    return res.status(200).json({ chats: data });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load chat history", error: error.message });
  }
}
