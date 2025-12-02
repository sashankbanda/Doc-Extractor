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
MODEL_NAME = "llama-3.1-8b-instant"

def structure_with_groq(raw_text: str) -> Dict:
    """Send raw text to Groq and return structured JSON fields."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.warning("GROQ_API_KEY not configured; returning empty field set")
        return {"fields": []}

    truncated_text = raw_text[:15000]
    system_prompt = (
        "You are a document extraction assistant. Given the raw text of a PDF document, "
        "extract EVERY piece of data you can find. Return JSON with a 'fields' array. "
        "Each field MUST have: label (descriptive name), value (exact text from document), "
        "snippet (the exact substring as it appears in the document - this is critical for highlighting). "
        "For tables, use format: TableName[rowIndex].ColumnName as label. "
        "Extract ALL data including: headers, policy info, names, dates, amounts, IDs, "
        "table rows, totals, subtotals, claim details, descriptions, etc. "
        "The snippet MUST be the EXACT text as it appears in the document for accurate highlighting."
    )
    user_prompt = (
        "Extract ALL structured data from this document. Include every field, table cell, "
        "header, date, amount, name, ID, and description you find. "
        "For each field, the 'snippet' must be the EXACT text from the document. "
        "Respond with compact JSON only.\n\n" + truncated_text
    )

    payload = {
        "model": MODEL_NAME,
        "temperature": 0.2,
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
        response = requests.post(GROQ_ENDPOINT, headers=headers, json=payload, timeout=90)
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return _ensure_json_dict(content)
    except requests.exceptions.HTTPError as exc:
        logger.error("Groq HTTP error: %s - Response: %s", exc, exc.response.text if hasattr(exc, 'response') else 'No response')
        return {"fields": []}
    except Exception as exc:  # noqa: BLE001
        logger.error("Groq structuring failed: %s", exc)
        return {"fields": []}


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
