from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Dict, List, Optional

import requests
from dotenv import load_dotenv

# Load .env file from the project root
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

logger = logging.getLogger(__name__)
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
MODEL_NAME = "llama-3.3-70b-versatile"  # More capable model for better extraction


def structure_with_groq(raw_text: str) -> Dict:
    """Send raw text to Groq and return structured JSON fields."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.warning("GROQ_API_KEY not configured; returning empty field set")
        return {"fields": []}

    # Process in chunks if text is long
    all_fields = []
    chunk_size = 25000  # Increased chunk size
    text_chunks = _split_text_into_chunks(raw_text, chunk_size)
    
    for chunk_index, chunk in enumerate(text_chunks):
        logger.info(f"Processing chunk {chunk_index + 1}/{len(text_chunks)}")
        fields = _extract_from_chunk(chunk, api_key, chunk_index)
        all_fields.extend(fields)
    
    return {"fields": all_fields}


def _split_text_into_chunks(text: str, chunk_size: int) -> List[str]:
    """Split text into overlapping chunks to avoid missing data at boundaries."""
    if len(text) <= chunk_size:
        return [text]
    
    chunks = []
    overlap = 500  # Overlap to catch data at boundaries
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunks.append(text[start:end])
        start = end - overlap if end < len(text) else end
    return chunks


def _extract_from_chunk(text_chunk: str, api_key: str, chunk_index: int) -> List[Dict]:
    """Extract fields from a single text chunk."""
    system_prompt = """You are a precise document extraction assistant. Extract ALL data from the document text.

CRITICAL RULES:
1. The 'snippet' field MUST contain the EXACT text as it appears in the document - copy it character by character
2. Extract EVERY piece of information: headers, labels, values, table cells, dates, amounts, IDs, names, descriptions
3. For table data, use label format: "TableName[row].ColumnName" (e.g., "Claims[0].Amount")
4. Do NOT paraphrase or modify the text - use exact matches only
5. Include ALL rows from ALL tables
6. Extract both the label/header AND its corresponding value

Return JSON with format:
{
  "fields": [
    {"label": "descriptive_name", "value": "the extracted value", "snippet": "EXACT text from document"}
  ]
}

The snippet is used to locate and highlight the text in the PDF, so it MUST be an exact substring from the input."""

    user_prompt = f"""Extract ALL data from this document section. For each piece of data:
- label: A descriptive name for the field
- value: The actual value/content
- snippet: The EXACT text as it appears (copy-paste from document)

Document text:
{text_chunk}

Return compact JSON only."""

    payload = {
        "model": MODEL_NAME,
        "temperature": 0.1,  # Lower temperature for more accurate extraction
        "max_tokens": 8000,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(GROQ_ENDPOINT, headers=headers, json=payload, timeout=120)
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        result = _ensure_json_dict(content)
        fields = result.get("fields", [])
        
        # Validate and clean fields
        validated_fields = []
        for field in fields:
            if not isinstance(field, dict):
                continue
            label = field.get("label") or field.get("name") or "Unknown"
            value = str(field.get("value", "")).strip()
            snippet = str(field.get("snippet", "")).strip() or value
            
            if value:  # Only include fields with values
                validated_fields.append({
                    "label": label,
                    "value": value,
                    "snippet": snippet,
                })
        
        return validated_fields
    except requests.exceptions.HTTPError as exc:
        logger.error("Groq HTTP error: %s - Response: %s", exc, exc.response.text if hasattr(exc, 'response') else 'No response')
        return []
    except Exception as exc:
        logger.error("Groq structuring failed: %s", exc)
        return []


def _ensure_json_dict(content: str) -> Dict:
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        logger.warning("Unable to parse Groq response; returning empty fields")
        return {"fields": []}
