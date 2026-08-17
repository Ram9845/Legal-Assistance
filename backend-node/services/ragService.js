const FASTAPI_URL = process.env.BACKEND_FASTAPI_URL || "http://127.0.0.1:8000";

export async function askFastApi(query, documentText = "") {
  const res = await fetch(`${FASTAPI_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, document_text: documentText }),
  });

  if (!res.ok) {
    throw new Error(`FastAPI request failed with ${res.status}`);
  }

  return await res.json();
}

export async function getMlStats() {
  try {
    const res = await fetch(`${FASTAPI_URL}/stats`);
    if (!res.ok) {
      return { error: `Failed with ${res.status}` };
    }
    return await res.json();
  } catch (err) {
    console.error("Error fetching stats:", err);
    return { error: err.message };
  }
}
