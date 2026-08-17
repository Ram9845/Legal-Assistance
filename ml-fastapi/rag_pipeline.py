"""
RAG Pipeline — ChromaDB vector search with BM25 fallback.

Flow:
1. If ChromaDB is populated → semantic vector search against Supreme Court PDFs
2. If ChromaDB not available → falls back to BM25 keyword search on india_legal_corpus.jsonl
"""

from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

# ── ChromaDB imports (may not be installed in all envs) ──
try:
    import chromadb
    from chromadb.utils import embedding_functions
    CHROMA_AVAILABLE = True
except ImportError:
    CHROMA_AVAILABLE = False

CHROMA_DB_DIR = "./chroma_db"

# ── BM25 Fallback constants ──
TOKEN_RE = re.compile(r"[a-z0-9]+")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
WRAPPER_PROMPT_RE = re.compile(
    r"^(explain in simple language(?: for a non-lawyer)?\s*:\s*)+",
    flags=re.IGNORECASE,
)
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "how", "i", "if", "in", "is", "it", "of", "on", "or", "that",
    "the", "to", "was", "what", "when", "where", "which", "who", "why", "with",
}


# ═══════════════════════════════════════════════════════════════════════════════
# ChromaDB Vector Search
# ═══════════════════════════════════════════════════════════════════════════════

def _chroma_is_populated() -> bool:
    """Check if ChromaDB exists and has data."""
    if not CHROMA_AVAILABLE:
        return False
    if not os.path.exists(CHROMA_DB_DIR):
        return False
    try:
        import chromadb.config
        client_settings = chromadb.config.Settings(anonymized_telemetry=False)
        client = chromadb.PersistentClient(path=CHROMA_DB_DIR, settings=client_settings)
        collection = client.get_collection("supreme_court_cases")
        return collection.count() > 0
    except Exception:
        return False


def _chroma_search(query: str, n_results: int = 5) -> list[dict]:
    """Search ChromaDB for the most relevant Supreme Court case chunks."""
    try:
        import chromadb.config
        client_settings = chromadb.config.Settings(anonymized_telemetry=False)
        client = chromadb.PersistentClient(path=CHROMA_DB_DIR, settings=client_settings)
        collection = client.get_collection(
            name="supreme_court_cases"
        )

        results = collection.query(query_texts=[query], n_results=n_results)

        documents = results.get("documents", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]

        chunks = []
        for doc, meta in zip(documents, metadatas):
            source = meta.get("source", "Unknown") if meta else "Unknown"
            chunks.append({"text": doc, "source": source})
        return chunks

    except Exception as e:
        print(f"ChromaDB search error: {e}")
        return []


# ═══════════════════════════════════════════════════════════════════════════════
# BM25 Fallback (searches india_legal_corpus.jsonl)
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class LegalChunk:
    chunk_id: str
    title: str
    citation: str
    year: str
    text: str
    tags: tuple[str, ...]


@dataclass(frozen=True)
class IndexedChunk:
    chunk: LegalChunk
    tf: dict[str, int]
    length: int


@dataclass(frozen=True)
class RagIndex:
    chunks: tuple[IndexedChunk, ...]
    idf: dict[str, float]
    avg_doc_len: float


def _tokenize(text: str) -> list[str]:
    raw = TOKEN_RE.findall((text or "").lower())
    return [t for t in raw if t not in STOPWORDS and len(t) > 1]


def _normalize_query(text: str) -> str:
    cleaned = (text or "").strip()
    cleaned = WRAPPER_PROMPT_RE.sub("", cleaned)
    return cleaned.strip()


@lru_cache(maxsize=1)
def _build_bm25_index() -> RagIndex:
    path = Path(__file__).resolve().parent / "data" / "india_legal_corpus.jsonl"
    if not path.exists():
        return RagIndex(chunks=tuple(), idf={}, avg_doc_len=1.0)

    chunks: list[IndexedChunk] = []
    doc_freq: dict[str, int] = {}

    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            text = str(data.get("text", "")).strip()
            if not text:
                continue

            lc = LegalChunk(
                chunk_id=str(data.get("id", "")),
                title=str(data.get("title", "")),
                citation=str(data.get("citation", "")),
                year=str(data.get("year", "")),
                text=text,
                tags=tuple(str(t) for t in data.get("tags", [])),
            )
            tokens = _tokenize(f"{lc.title} {lc.text} {' '.join(lc.tags)}")
            if not tokens:
                continue

            tf: dict[str, int] = {}
            seen = set()
            for t in tokens:
                tf[t] = tf.get(t, 0) + 1
                seen.add(t)
            for t in seen:
                doc_freq[t] = doc_freq.get(t, 0) + 1

            chunks.append(IndexedChunk(chunk=lc, tf=tf, length=len(tokens)))

    n = len(chunks)
    if n == 0:
        return RagIndex(chunks=tuple(), idf={}, avg_doc_len=1.0)

    idf = {t: math.log(1.0 + (n - df + 0.5) / (df + 0.5)) for t, df in doc_freq.items()}
    avg_len = sum(c.length for c in chunks) / n
    return RagIndex(chunks=tuple(chunks), idf=idf, avg_doc_len=max(avg_len, 1.0))


def _bm25_search(query: str, top_k: int = 5) -> list[dict]:
    index = _build_bm25_index()
    tokens = _tokenize(query)
    if not tokens:
        return []

    query_set = set(tokens)
    scored = []

    for ic in index.chunks:
        overlap = len(query_set.intersection(ic.tf.keys()))
        if overlap == 0:
            continue
        score = 0.0
        for t in tokens:
            tf = ic.tf.get(t, 0)
            if tf <= 0:
                continue
            idf_val = index.idf.get(t, 0.0)
            denom = tf + 1.5 * (1 - 0.75 + 0.75 * ic.length / index.avg_doc_len)
            score += idf_val * (tf * 2.5 / denom)
        if score > 0 and overlap >= 1:
            scored.append((ic, score))

    scored.sort(key=lambda x: x[1], reverse=True)

    results = []
    for ic, _score in scored[:top_k]:
        results.append({
            "text": ic.chunk.text,
            "source": f"{ic.chunk.title} ({ic.chunk.year}) | {ic.chunk.citation}",
        })
    return results


# ═══════════════════════════════════════════════════════════════════════════════
# Public API
# ═══════════════════════════════════════════════════════════════════════════════

def run_rag(query: str, document_text: str = "") -> str:
    """
    Main entry point. Returns matched context chunks as a formatted string.
    Uses ChromaDB if available, otherwise falls back to BM25.
    """
    question = _normalize_query(query)
    if not question and not document_text:
        return "Please type a legal question."

    # Build the search query: combine user question + document snippet
    search_query = question
    if document_text:
        # Use first 500 words of document for better matching
        doc_snippet = " ".join(document_text.split()[:500])
        search_query = f"{question} {doc_snippet}"

    # Try ChromaDB first, fallback to BM25
    chunks = []
    search_method = "unknown"

    if _chroma_is_populated():
        chunks = _chroma_search(search_query)
        search_method = "ChromaDB Vector Search (Supreme Court PDFs)"
    
    if not chunks:
        chunks = _bm25_search(search_query)
        search_method = "BM25 Keyword Search (Legal Corpus)"

    if not chunks:
        return (
            f"Question: {question}\n\n"
            "No relevant legal context found in the database.\n"
            "Try rephrasing with specific legal terms like: section, act, IPC, CrPC, etc."
        )

    # Format the matched chunks
    context_parts = []
    for i, chunk in enumerate(chunks, 1):
        context_parts.append(
            f"[{i}] SOURCE: {chunk['source']}\n{chunk['text']}"
        )

    return (
        f"Search Method: {search_method}\n"
        f"Matched {len(chunks)} relevant legal context(s):\n\n"
        + "\n\n---\n\n".join(context_parts)
    )
