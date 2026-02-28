const FASTAPI_URL = process.env.BACKEND_FASTAPI_URL || "http://localhost:8000";

export async function askFastApi(query) {
  const res = await fetch(`${FASTAPI_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`FastAPI request failed with ${res.status}`);
  }

  const data = await res.json();
  return data?.answer || "No answer returned by model.";
}
