import { Router } from "express";
import {
  registerUser,
  loginUser,
  googleLogin,
  startGithubLogin,
  githubCallback,
  getCurrentUser,
} from "../controllers/authController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/google", googleLogin);
router.get("/github/start", startGithubLogin);
router.get("/github/callback", githubCallback);
router.get("/me", requireAuth, getCurrentUser);

export default router;
