from fastapi import FastAPI
from pydantic import BaseModel

from rag_pipeline import run_rag

app = FastAPI(title="Legal RAG FastAPI")


class QueryRequest(BaseModel):
    query: str


@app.get("/")
def root():
    return {"message": "Legal RAG FastAPI service is running"}


@app.post("/query")
def query_docs(payload: QueryRequest):
    answer = run_rag(payload.query)
    return {"query": payload.query, "answer": answer}
