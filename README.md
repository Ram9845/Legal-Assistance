# Legal RAG Fullstack

This project contains:
- `frontend` (EJS + Express, port `3000`)
- `backend-node` (Express API, port `5000`)
- `ml-fastapi` (FastAPI, port `8000`)

## Run Locally

Fastest on Windows (no `npm` PowerShell policy issues):
```bat
run-project.bat
```

Alternative:

1. Install dependencies (already present in this workspace):
```powershell
npm --prefix frontend install
npm --prefix backend-node install
python -m pip install -r ml-fastapi/requirements.txt
```

2. Start each service in a separate terminal:
```powershell
npm run start:ml
npm run start:backend
npm run start:frontend
```

3. Open:
- `http://localhost:3000`

## Notes

- Backend now supports automatic local JSON persistence fallback when MongoDB is unavailable.
- Local fallback files:
  - `backend-node/data/users.json`
  - `backend-node/data/chats.json`
- If MongoDB is available and `MONGO_URI` works, backend uses MongoDB automatically.

## India RAG

- Active RAG file: `ml-fastapi/rag_pipeline.py`
- Corpus file: `ml-fastapi/data/india_legal_corpus.jsonl`
- Retrieval method: local BM25-style lexical retrieval with source citations.

To scale to a larger India corpus (for example 50,000 Supreme Court documents):
1. Convert judgments to JSONL records using the same fields as `india_legal_corpus.jsonl`.
2. Append/replace the corpus file with those records.
3. Restart FastAPI service (`start:ml`) so the index rebuilds.
