import { Router } from "express";
import multer from "multer";
import {
  queryLegalAssistant,
  uploadFiles,
  getMyChatHistory,
} from "../controllers/chatController.js";
import { optionalAuth, requireAuth } from "../middleware/authMiddleware.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

router.post("/query", optionalAuth, queryLegalAssistant);
router.post("/upload", optionalAuth, upload.array("files", 5), uploadFiles);
router.get("/history", requireAuth, getMyChatHistory);

export default router;
