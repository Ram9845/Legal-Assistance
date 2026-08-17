from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional
import json
import joblib
import time

from rag_pipeline import run_rag

app = FastAPI(title="Legal RAG & ML FastAPI")

# Load ML Model at startup
try:
    classifier = joblib.load("models/case_classifier.pkl")
    print("✅ Loaded ML model (case_classifier.pkl) successfully.")
except Exception as e:
    print(f"⚠️ Could not load ML model: {e}")
    classifier = None

# Load dataset stats
try:
    with open("data/dataset_stats.json", "r", encoding="utf-8") as f:
        dataset_stats = json.load(f)
except Exception as e:
    print(f"⚠️ Could not load dataset stats: {e}")
    dataset_stats = {}


class QueryRequest(BaseModel):
    query: str
    document_text: Optional[str] = ""


class PredictRequest(BaseModel):
    text: str


class SearchRequest(BaseModel):
    keyword: str
    judge: Optional[str] = None
    year: Optional[str] = None
    petitioner: Optional[str] = None


@app.get("/")
def root():
    return {"message": "Legal RAG & ML FastAPI service is running"}


@app.post("/query")
def query_docs(payload: QueryRequest):
    start_time = time.time()

    # 1. Run RAG (ChromaDB or BM25 fallback)
    t0 = time.time()
    rag_context = run_rag(payload.query, document_text=payload.document_text or "")
    rag_time = time.time() - t0

    # 2. Run ML Case Type Prediction
    ml_prediction = None
    ml_confidence = None
    t1 = time.time()
    if classifier is not None:
        try:
            predict_text = payload.query
            if payload.document_text:
                predict_text += " " + payload.document_text[:500]
            preds = classifier.predict_proba([predict_text])[0]
            max_idx = preds.argmax()
            ml_prediction = classifier.classes_[max_idx]
            ml_confidence = round(float(preds[max_idx]), 4)
        except Exception as e:
            print(f"ML prediction failed: {e}")
    ml_time = time.time() - t1

    total_time = time.time() - start_time
    print(f"Query processed in {total_time:.3f}s (RAG: {rag_time:.3f}s, ML: {ml_time:.3f}s) — {payload.query[:50]}...")

    return {
        "query": payload.query,
        "answer": rag_context,
        "ml_prediction": ml_prediction,
        "ml_confidence": ml_confidence,
    }


@app.post("/predict")
async def predict_case_type(req: PredictRequest):
    if classifier is None:
        return {"error": "Model not loaded"}
    try:
        preds = classifier.predict_proba([req.text])[0]
        max_idx = preds.argmax()
        return {
            "prediction": classifier.classes_[max_idx],
            "confidence": round(float(preds[max_idx]), 4),
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/stats")
async def get_stats():
    return dataset_stats


@app.post("/search")
async def search_cases(req: SearchRequest):
    results = []
    try:
        with open("data/legal_corpus_full.jsonl", "r", encoding="utf-8") as f:
            for line in f:
                doc = json.loads(line)
                if req.keyword and req.keyword.lower() not in doc.get("text", "").lower() and req.keyword.lower() not in doc.get("title", "").lower():
                    continue
                if req.year and req.year != str(doc.get("year", "")):
                    continue
                if req.judge and req.judge.lower() not in doc.get("judge", "").lower():
                    continue
                if req.petitioner and req.petitioner.lower() not in doc.get("petitioner", "").lower():
                    continue
                results.append({
                    "id": doc.get("id"),
                    "title": doc.get("title"),
                    "citation": doc.get("citation"),
                    "year": doc.get("year"),
                    "judge": doc.get("judge"),
                })
                if len(results) >= 20:
                    break
    except Exception as e:
        return {"error": str(e)}
    return {"results": results}
