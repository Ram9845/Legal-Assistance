"""
process_dataset.py
==================
Reads judgments.csv, trains a case-type classifier, generates an enriched
JSONL corpus for the RAG pipeline, and prints model metrics.

Run:  python process_dataset.py
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATASET_DIR = BASE_DIR.parent / "legal-dataset"
CSV_PATH = DATASET_DIR / "judgments.csv"
CORPUS_OUT = BASE_DIR / "data" / "legal_corpus_full.jsonl"
MODEL_DIR = BASE_DIR / "models"
MODEL_PATH = MODEL_DIR / "case_classifier.pkl"
STATS_PATH = BASE_DIR / "data" / "dataset_stats.json"

# ---------------------------------------------------------------------------
# Case-type extraction helpers
# ---------------------------------------------------------------------------
CASE_TYPE_PATTERNS: list[tuple[str, str]] = [
    (r"Crl\.?A\.", "Criminal Appeal"),
    (r"Crl\.?\s*Appeal", "Criminal Appeal"),
    (r"C\.?A\.\s*No", "Civil Appeal"),
    (r"SLP\s*\(\s*Crl\s*\)", "SLP Criminal"),
    (r"SLP\s*\(\s*C\s*\)", "SLP Civil"),
    (r"W\.?P\.?\s*\(\s*C\s*\)", "Writ Petition Civil"),
    (r"W\.?P\.?\s*\(\s*Crl\s*\)", "Writ Petition Criminal"),
    (r"T\.?P\.?\s*\(\s*C\s*\)", "Transfer Petition Civil"),
    (r"T\.?P\.?\s*\(\s*Crl\s*\)", "Transfer Petition Criminal"),
    (r"T\.?C\.?\s*\(\s*C\s*\)", "Transfer Case Civil"),
    (r"R\.?P\.?\s*\(\s*C\s*\)", "Review Petition Civil"),
    (r"R\.?P\.?\s*\(\s*Crl\s*\)", "Review Petition Criminal"),
    (r"CONMT\.?PET", "Contempt Petition"),
    (r"ARBIT\.?PET", "Arbitration Petition"),
    (r"SMW\s*\(\s*C\s*\)", "Suo Moto Writ Civil"),
    (r"SMW\s*\(\s*Crl\s*\)", "Suo Moto Writ Criminal"),
    (r"MA-", "Miscellaneous Application"),
]

_compiled_patterns = [(re.compile(p, re.IGNORECASE), label) for p, label in CASE_TYPE_PATTERNS]


def extract_case_type(case_no: str) -> str:
    """Return a human-readable case type from a raw case_no string."""
    if not case_no:
        return "Other"
    for pattern, label in _compiled_patterns:
        if pattern.search(case_no):
            return label
    return "Other"


def extract_year_from_date(date_str: str) -> str:
    """Best-effort year extraction from dd-mm-yyyy or similar."""
    if not date_str:
        return ""
    match = re.search(r"(\d{4})", date_str)
    return match.group(1) if match else ""


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
def main() -> None:
    print("=" * 60)
    print("Legal Dataset ML Pipeline")
    print("=" * 60)

    # ---- 1. Load CSV ----
    if not CSV_PATH.exists():
        print(f"ERROR: CSV not found at {CSV_PATH}")
        sys.exit(1)

    print(f"\n[1/5] Loading {CSV_PATH.name} …")
    df = pd.read_csv(CSV_PATH, encoding="utf-8", on_bad_lines="skip")
    print(f"  → Loaded {len(df):,} rows, {len(df.columns)} columns")
    print(f"  → Columns: {list(df.columns)}")

    # ---- 2. Clean & enrich ----
    print("\n[2/5] Cleaning & enriching data …")
    df["case_no"] = df["case_no"].fillna("").astype(str)
    df["pet"] = df["pet"].fillna("").astype(str)
    df["res"] = df["res"].fillna("").astype(str)
    df["bench"] = df["bench"].fillna("").astype(str)
    df["judgement_by"] = df["judgement_by"].fillna("").astype(str)
    df["judgment_dates"] = df["judgment_dates"].fillna("").astype(str)
    df["diary_no"] = df["diary_no"].fillna("").astype(str)
    df["pet_adv"] = df["pet_adv"].fillna("").astype(str)
    df["res_adv"] = df["res_adv"].fillna("").astype(str)
    df["temp_link"] = df["temp_link"].fillna("").astype(str)

    df["case_type"] = df["case_no"].apply(extract_case_type)
    df["year"] = df["judgment_dates"].apply(extract_year_from_date)

    # Build combined text feature for ML
    df["text_feature"] = (
        df["case_no"] + " " + df["pet"] + " vs " + df["res"] + " " + df["bench"]
    )

    type_dist = df["case_type"].value_counts()
    print("  → Case type distribution:")
    for ct, count in type_dist.items():
        print(f"      {ct}: {count:,}")

    # ---- 3. Train classifier ----
    print("\n[3/5] Training case-type classifier …")

    # Filter classes with enough samples
    min_samples = 20
    valid_types = type_dist[type_dist >= min_samples].index.tolist()
    df_train = df[df["case_type"].isin(valid_types)].copy()
    print(f"  → Using {len(df_train):,} rows ({len(valid_types)} case types with ≥{min_samples} samples)")

    X = df_train["text_feature"]
    y = df_train["case_type"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(
            max_features=10000,
            ngram_range=(1, 2),
            sublinear_tf=True,
            min_df=2,
        )),
        ("clf", RandomForestClassifier(
            n_estimators=100,
            max_depth=30,
            random_state=42,
            n_jobs=-1,
            class_weight="balanced",
        )),
    ])

    pipeline.fit(X_train, y_train)
    y_pred = pipeline.predict(X_test)

    acc = accuracy_score(y_test, y_pred)
    print(f"\n  ★ Test Accuracy: {acc:.4f} ({acc * 100:.1f}%)")
    print("\n  Classification Report:")
    report = classification_report(y_test, y_pred)
    print(report)

    # Save model
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, MODEL_PATH)
    print(f"  → Model saved to {MODEL_PATH}")

    # ---- 4. Generate enriched JSONL corpus ----
    print("\n[4/5] Generating enriched JSONL corpus for RAG …")
    CORPUS_OUT.parent.mkdir(parents=True, exist_ok=True)

    # Deduplicate by diary_no + case_no
    df_dedup = df.drop_duplicates(subset=["diary_no", "case_no"], keep="first")
    print(f"  → Deduplicated: {len(df):,} → {len(df_dedup):,} unique entries")

    written = 0
    with open(CORPUS_OUT, "w", encoding="utf-8") as f:
        for _, row in df_dedup.iterrows():
            title = f"{row['case_type']}: {row['pet'][:80]} vs {row['res'][:80]}"
            text = (
                f"Case: {row['case_no']}. "
                f"Petitioner: {row['pet']}. "
                f"Respondent: {row['res']}. "
                f"Petitioner Advocate: {row['pet_adv']}. "
                f"Respondent Advocate: {row['res_adv']}. "
                f"Bench: {row['bench']}. "
                f"Judgement by: {row['judgement_by']}. "
                f"Date: {row['judgment_dates']}."
            )
            tags = [row["case_type"]]
            if row["year"]:
                tags.append(row["year"])

            entry = {
                "id": f"{row['diary_no']}-{row['case_no'][:30]}".replace(" ", "_"),
                "title": title.strip(),
                "citation": row["case_no"],
                "year": row["year"],
                "text": text.strip(),
                "tags": tags,
                "judge": row["judgement_by"],
                "petitioner": row["pet"],
                "respondent": row["res"],
            }
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            written += 1

    print(f"  → Wrote {written:,} entries to {CORPUS_OUT}")

    # ---- 5. Generate stats JSON ----
    print("\n[5/5] Generating dataset statistics …")
    top_judges = (
        df["judgement_by"]
        .replace("", pd.NA)
        .dropna()
        .value_counts()
        .head(15)
        .to_dict()
    )
    year_dist = (
        df["year"]
        .replace("", pd.NA)
        .dropna()
        .value_counts()
        .sort_index()
        .to_dict()
    )

    stats = {
        "total_cases": int(len(df)),
        "unique_cases": int(len(df_dedup)),
        "case_type_distribution": {k: int(v) for k, v in type_dist.items()},
        "top_judges": {k: int(v) for k, v in top_judges.items()},
        "year_distribution": {k: int(v) for k, v in year_dist.items()},
        "model_accuracy": round(acc, 4),
        "model_classes": valid_types,
    }
    with open(STATS_PATH, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)
    print(f"  → Stats saved to {STATS_PATH}")

    print("\n" + "=" * 60)
    print("DONE ✓  Model accuracy: {:.1f}%".format(acc * 100))
    print("=" * 60)


if __name__ == "__main__":
    main()
