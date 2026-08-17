import os
import fitz  # PyMuPDF
import pandas as pd
import chromadb
from chromadb.utils import embedding_functions

# Paths (Run this script inside the ml-fastapi container or locally from project root)
DATASET_DIR = "/app/legal-dataset" if os.path.exists("/app/legal-dataset") else "../legal-dataset"
PDF_DIR = os.path.join(DATASET_DIR, "pdfs")
CSV_PATH = os.path.join(DATASET_DIR, "judgments.csv")
CHROMA_DB_DIR = "./chroma_db"

def extract_text_from_pdf(pdf_path: str) -> str:
    try:
        doc = fitz.open(pdf_path)
        text = ""
        for page in doc:
            text += page.get_text("text") + "\n"
        return text
    except Exception as e:
        print(f"Error reading {pdf_path}: {e}")
        return ""

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 100) -> list[str]:
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk_words = words[i:i + chunk_size]
        chunks.append(" ".join(chunk_words))
        i += (chunk_size - overlap)
    return chunks

def main():
    if not os.path.exists(PDF_DIR) or not os.path.exists(CSV_PATH):
        print(f"Dataset not found at {DATASET_DIR}. Exiting.")
        return

    print("Loading judgment metadata...")
    # Load CSV, handling any bad lines
    df = pd.read_csv(CSV_PATH, on_bad_lines='skip', low_memory=False)
    
    # Initialize ChromaDB client
    print(f"Initializing ChromaDB at {CHROMA_DB_DIR}...")
    
    # Disable Chroma telemetry to prevent PostHog crash
    import chromadb.config
    client_settings = chromadb.config.Settings(anonymized_telemetry=False)
    chroma_client = chromadb.PersistentClient(path=CHROMA_DB_DIR, settings=client_settings)
    
    # Use Chroma's default ONNX embedding function (all-MiniLM-L6-v2)
    collection = chroma_client.get_or_create_collection(
        name="supreme_court_cases"
    )
    
    pdf_files = [f for f in os.listdir(PDF_DIR) if f.endswith(".pdf")]
    print(f"Found {len(pdf_files)} PDFs to process.")
    
    # Process only a subset to start, to avoid massive first-run times (process max 1000 for this run)
    MAX_DOCS = 100
    count = 0

    for pdf_file in pdf_files:
        if count >= MAX_DOCS:
            break
            
        pdf_path = os.path.join(PDF_DIR, pdf_file)
        # Find matching metadata by matching the temp_link or filename
        # The temp_link has the filename at the end: supremecourt/2021/5/.../5_2021_36_1501_28814_Judgement_23-Jul-2021.pdf
        # Wait, the filenames in `pdfs/` are like `-0___jonew__judis__10166.pdf`
        # We will just embed the text for now, as metadata linking requires careful string matching.
        
        print(f"[{count+1}/{MAX_DOCS}] Processing {pdf_file}...")
        
        text = extract_text_from_pdf(pdf_path)
        if not text.strip():
            continue
            
        chunks = chunk_text(text)
        
        # Prepare batch for Chroma
        ids = [f"{pdf_file}_chunk_{i}" for i in range(len(chunks))]
        metadatas = [{"source": pdf_file, "chunk_idx": i} for i in range(len(chunks))]
        
        try:
            collection.add(
                documents=chunks,
                metadatas=metadatas,
                ids=ids
            )
            count += 1
        except Exception as e:
            print(f"Failed to add {pdf_file} to Chroma: {e}")

    print("Ingestion complete!")
    print(f"Collection now has {collection.count()} chunks.")

if __name__ == "__main__":
    main()
