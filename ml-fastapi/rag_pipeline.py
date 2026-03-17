from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


TOKEN_RE = re.compile(r"[a-z0-9]+")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
WRAPPER_PROMPT_RE = re.compile(
    r"^(explain in simple language(?: for a non-lawyer)?\s*:\s*)+",
    flags=re.IGNORECASE,
)
STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "how",
    "i",
    "if",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "was",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
}


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
    tokens: tuple[str, ...]
    tf: dict[str, int]
    length: int


@dataclass(frozen=True)
class RagIndex:
    chunks: tuple[IndexedChunk, ...]
    idf: dict[str, float]
    avg_doc_len: float


def _normalize_query(text: str) -> str:
    cleaned = (text or "").strip()
    cleaned = WRAPPER_PROMPT_RE.sub("", cleaned)
    return cleaned.strip()


def _tokenize(text: str) -> list[str]:
    raw = TOKEN_RE.findall((text or "").lower())
    return [token for token in raw if token not in STOPWORDS and len(token) > 1]


def _corpus_path() -> Path:
    return Path(__file__).resolve().parent / "data" / "india_legal_corpus.jsonl"


def _parse_line(raw_line: str) -> LegalChunk | None:
    line = raw_line.strip()
    if not line:
        return None
    data = json.loads(line)
    return LegalChunk(
        chunk_id=str(data.get("id", "")),
        title=str(data.get("title", "Untitled Source")),
        citation=str(data.get("citation", "Unknown citation")),
        year=str(data.get("year", "")),
        text=str(data.get("text", "")).strip(),
        tags=tuple(str(tag) for tag in data.get("tags", [])),
    )


@lru_cache(maxsize=1)
def _build_index() -> RagIndex:
    path = _corpus_path()
    if not path.exists():
        return RagIndex(chunks=tuple(), idf={}, avg_doc_len=1.0)

    chunks: list[IndexedChunk] = []
    document_frequency: dict[str, int] = {}

    with path.open("r", encoding="utf-8") as file:
        for raw in file:
            chunk = _parse_line(raw)
            if not chunk or not chunk.text:
                continue
            tokens = _tokenize(f"{chunk.title} {chunk.text} {' '.join(chunk.tags)}")
            if not tokens:
                continue
            tf: dict[str, int] = {}
            seen = set()
            for token in tokens:
                tf[token] = tf.get(token, 0) + 1
                seen.add(token)
            for token in seen:
                document_frequency[token] = document_frequency.get(token, 0) + 1
            chunks.append(
                IndexedChunk(chunk=chunk, tokens=tuple(tokens), tf=tf, length=len(tokens))
            )

    total_docs = len(chunks)
    if total_docs == 0:
        return RagIndex(chunks=tuple(), idf={}, avg_doc_len=1.0)

    idf: dict[str, float] = {}
    for token, df in document_frequency.items():
        # BM25-style smooth IDF.
        idf[token] = math.log(1.0 + (total_docs - df + 0.5) / (df + 0.5))

    avg_len = sum(chunk.length for chunk in chunks) / total_docs
    return RagIndex(chunks=tuple(chunks), idf=idf, avg_doc_len=max(avg_len, 1.0))


def _bm25_score(query_tokens: list[str], idx_chunk: IndexedChunk, index: RagIndex) -> float:
    if not query_tokens:
        return 0.0

    k1 = 1.5
    b = 0.75
    score = 0.0
    for token in query_tokens:
        tf = idx_chunk.tf.get(token, 0)
        if tf <= 0:
            continue
        idf = index.idf.get(token, 0.0)
        denom = tf + k1 * (1 - b + b * idx_chunk.length / index.avg_doc_len)
        score += idf * (tf * (k1 + 1) / denom)
    return score


def _retrieve(question: str, top_k: int = 4) -> list[tuple[IndexedChunk, float]]:
    index = _build_index()
    query_tokens = _tokenize(question)
    if not query_tokens:
        return []

    scored: list[tuple[IndexedChunk, float]] = []
    query_set = set(query_tokens)
    for idx_chunk in index.chunks:
        overlap = len(query_set.intersection(idx_chunk.tf.keys()))
        if overlap == 0:
            continue
        score = _bm25_score(query_tokens, idx_chunk, index)
        # Keep only chunks with meaningful lexical overlap.
        if score > 0 and overlap >= max(1, min(2, len(query_set) // 3)):
            scored.append((idx_chunk, score))

    scored.sort(key=lambda item: item[1], reverse=True)
    return scored[:top_k]


def _best_sentence(text: str, query_tokens: list[str]) -> str:
    sentences = [part.strip() for part in SENTENCE_SPLIT_RE.split(text) if part.strip()]
    if not sentences:
        return text.strip()

    best = sentences[0]
    best_score = -1
    query_set = set(query_tokens)
    for sentence in sentences:
        s_tokens = set(_tokenize(sentence))
        overlap = len(query_set.intersection(s_tokens))
        if overlap > best_score:
            best = sentence
            best_score = overlap
    return best


def _fallback_answer(question: str) -> str:
    return (
        f"Simple explanation (India context):\n{question}\n\n"
        "I could not find a strong match in the local India legal corpus for this query.\n"
        "Try adding details like: state, offense type, contract/employment/property context, and timeline.\n\n"
        "This is general legal information, not legal advice."
    )


def run_rag(query: str) -> str:
    question = _normalize_query(query)
    if not question:
        return "Please type a legal question."

    query_tokens = _tokenize(question)
    retrieved = _retrieve(question)
    if not retrieved:
        return _fallback_answer(question)

    points: list[str] = []
    sources: list[str] = []
    seen_points = set()

    for idx_chunk, _score in retrieved:
        sentence = _best_sentence(idx_chunk.chunk.text, query_tokens)
        point = sentence.strip()
        if point and point.lower() not in seen_points:
            points.append(f"- {point}")
            seen_points.add(point.lower())
        source_line = (
            f"- {idx_chunk.chunk.title} ({idx_chunk.chunk.year}) | {idx_chunk.chunk.citation}"
        )
        sources.append(source_line)

    body = "\n".join(points[:4]) if points else "- No direct point extracted."
    sources_block = "\n".join(sources[:4])

    return (
        f"India legal explanation (general information):\nQuestion: {question}\n\n"
        f"Relevant points:\n{body}\n\n"
        f"Sources used:\n{sources_block}\n\n"
        "Important: This is general legal information, not a substitute for advice from a licensed advocate."
    )
