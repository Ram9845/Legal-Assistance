import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, default: "application/octet-stream" },
    sizeLabel: { type: String, default: "" },
    kind: { type: String, enum: ["image", "file"], default: "file" },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    text: { type: String, required: true },
    attachments: { type: [attachmentSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const chatSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    title: { type: String, default: "New legal question" },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true }
);

const ChatSession =
  mongoose.models.ChatSession || mongoose.model("ChatSession", chatSessionSchema);

export default ChatSession;
