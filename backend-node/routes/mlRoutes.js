import express from "express";
import { getStats, predictText } from "../controllers/mlController.js";

const router = express.Router();

router.get("/stats", getStats);
router.post("/predict", predictText);

export default router;
