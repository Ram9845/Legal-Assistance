import mongoose from "mongoose";
import { setMongoAvailability } from "../services/persistenceMode.js";

function fallbackUriIfDockerHostname(uri) {
  if (!uri) {
    return null;
  }
  if (!uri.includes("://mongo")) {
    return null;
  }
  return uri.replace("://mongo", "://127.0.0.1");
}

export async function connectDB() {
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/legal_rag";
  const fallbackUri = fallbackUriIfDockerHostname(mongoUri);

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
    setMongoAvailability(true);
    console.log("Connected to MongoDB");
    return;
  } catch (error) {
    if (!fallbackUri || fallbackUri === mongoUri) {
      setMongoAvailability(false);
      console.warn("MongoDB unavailable. Falling back to local JSON persistence.");
      return;
    }

    try {
      await mongoose.connect(fallbackUri, { serverSelectionTimeoutMS: 3000 });
      setMongoAvailability(true);
      console.log(`Connected to MongoDB using fallback URI: ${fallbackUri}`);
      return;
    } catch (_fallbackError) {
      setMongoAvailability(false);
      console.warn("MongoDB unavailable. Falling back to local JSON persistence.");
    }
  }
}
