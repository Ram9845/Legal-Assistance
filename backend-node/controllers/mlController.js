import fetch from "node-fetch";

const FASTAPI_URL = process.env.BACKEND_FASTAPI_URL || "http://127.0.0.1:8000";

export const getStats = async (req, res) => {
  try {
    const response = await fetch(`${FASTAPI_URL}/stats`);
    if (!response.ok) {
      return res.status(response.status).json({ message: "Failed to fetch stats from ML service" });
    }
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error in getStats:", error);
    return res.status(500).json({ message: "Internal server error connecting to ML service" });
  }
};

export const predictText = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ message: "Text is required for prediction" });
    }
    
    const response = await fetch(`${FASTAPI_URL}/predict`, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ text })
    });
    
    if (!response.ok) {
        return res.status(response.status).json({ message: "Failed to predict text from ML service" });
    }
    
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error in predictText:", error);
    return res.status(500).json({ message: "Internal server error connecting to ML service" });
  }
};
