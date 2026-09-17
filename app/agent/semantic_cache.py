import math
import json
import re
import hashlib
from typing import List, Optional, Tuple, Dict, Any
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import logging

logger = logging.getLogger("cyclode.semantic_cache")

from app.db.models import SemanticCacheModel, get_utc_now


def normalize_query(text: str) -> str:
    """
    Normalizes a query string for indexing and exact-match cache checks.
    """
    cleaned = text.lower().strip()
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def compute_fallback_embedding(text: str, dim: int = 128) -> List[float]:
    """
    Computes a deterministic character/word n-gram embedding vector with L2 normalization
    for offline execution and fallback similarity computation.
    """
    vec = [0.0] * dim
    norm_text = normalize_query(text)
    if not norm_text:
        return vec

    # Word-level features
    words = norm_text.split()
    for w in words:
        h = int(hashlib.md5(w.encode("utf-8")).hexdigest(), 16) % dim
        vec[h] += 1.5

    # Character tri-gram features
    for i in range(len(norm_text) - 2):
        trigram = norm_text[i:i+3]
        h = int(hashlib.sha256(trigram.encode("utf-8")).hexdigest(), 16) % dim
        vec[h] += 1.0

    # L2 normalize
    magnitude = math.sqrt(sum(x * x for x in vec))
    if magnitude > 0:
        vec = [x / magnitude for x in vec]
    return vec


def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """
    Computes cosine similarity between two float vectors.
    Returns float in range [-1.0, 1.0].
    """
    if not vec1 or not vec2:
        return 0.0
    if len(vec1) != len(vec2):
        min_len = min(len(vec1), len(vec2))
        vec1 = vec1[:min_len]
        vec2 = vec2[:min_len]

    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    mag1 = math.sqrt(sum(a * a for a in vec1))
    mag2 = math.sqrt(sum(b * b for b in vec2))

    if mag1 == 0.0 or mag2 == 0.0:
        return 0.0
    return dot_product / (mag1 * mag2)


async def generate_query_embedding(
    text: str,
    api_key: str = "",
    client: Optional[httpx.AsyncClient] = None
) -> List[float]:
    """
    Generates a dense vector embedding using Gemini text-embedding-004 or OpenAI text-embedding-3-small
    if an API key is provided, otherwise gracefully falls back to deterministic n-gram vectorization.
    """
    if api_key and client:
        # Check if OpenAI key
        if api_key.startswith("sk-"):
            url = "https://api.openai.com/v1/embeddings"
            payload = {
                "model": "text-embedding-3-small",
                "input": text[:1000]
            }
            headers = {"Authorization": f"Bearer {api_key}"}
            try:
                resp = await client.post(url, json=payload, headers=headers, timeout=4.0)
                if resp.status_code == 200:
                    data = resp.json()
                    emb_list = data.get("data", [])
                    if emb_list and "embedding" in emb_list[0]:
                        values = emb_list[0]["embedding"]
                        mag = math.sqrt(sum(v * v for v in values))
                        if mag > 0:
                            return [v / mag for v in values]
                        return values
            except Exception as e:
                logger.debug(f"OpenAI embedding endpoint exception, falling back to local vectorizer: {e}")
        else:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key={api_key}"
            payload = {
                "model": "models/text-embedding-004",
                "content": {
                    "parts": [{"text": text[:1000]}]
                }
            }
            try:
                resp = await client.post(url, json=payload, timeout=4.0)
                if resp.status_code == 200:
                    data = resp.json()
                    values = data.get("embedding", {}).get("values", [])
                    if values and isinstance(values, list):
                        mag = math.sqrt(sum(v * v for v in values))
                        if mag > 0:
                            return [v / mag for v in values]
                        return values
            except Exception as e:
                logger.debug(f"Gemini embedding endpoint exception, falling back to local vectorizer: {e}")

    return compute_fallback_embedding(text)


async def lookup_semantic_cache(
    db: Optional[AsyncSession],
    query: str,
    api_key: str = "",
    client: Optional[httpx.AsyncClient] = None,
    threshold: float = 0.90,
    intent: str = "qa_research"
) -> Optional[Tuple[SemanticCacheModel, float]]:
    """
    Searches the local SQLite semantic_cache table for semantically similar responses.
    Strictly isolated to read-only intent categories (e.g. qa_research).
    """
    if db is None or intent != "qa_research" or not query.strip():
        return None

    norm = normalize_query(query)
    
    # 1. Fast exact normalized query check
    res = await db.execute(
        select(SemanticCacheModel)
        .where(SemanticCacheModel.query_norm == norm, SemanticCacheModel.intent_category == intent)
    )
    exact_match = res.scalar_one_or_none()
    if exact_match:
        exact_match.hit_count += 1
        exact_match.last_hit_at = get_utc_now()
        await db.commit()
        return (exact_match, 1.0)

    # 2. Vector Cosine Similarity Search
    query_vec = await generate_query_embedding(query, api_key=api_key, client=client)
    if not query_vec:
        return None

    res = await db.execute(
        select(SemanticCacheModel)
        .where(SemanticCacheModel.intent_category == intent)
    )
    candidates = res.scalars().all()

    best_match: Optional[SemanticCacheModel] = None
    best_score = 0.0

    for item in candidates:
        try:
            item_vec = json.loads(item.embedding_json)
            sim = cosine_similarity(query_vec, item_vec)
            target_threshold = threshold if threshold is not None else (item.similarity_threshold or 0.90)
            if sim >= target_threshold and sim > best_score:
                best_score = sim
                best_match = item
        except Exception as e:
            logger.debug(f"Error computing cosine similarity on item {item.id}: {e}")
            continue

    if best_match and best_score >= threshold:
        best_match.hit_count += 1
        best_match.last_hit_at = get_utc_now()
        await db.commit()
        return (best_match, best_score)

    return None


async def store_semantic_cache(
    db: Optional[AsyncSession],
    query: str,
    plan: Optional[Dict[str, Any]],
    response_text: str,
    api_key: str = "",
    client: Optional[httpx.AsyncClient] = None,
    intent: str = "qa_research",
    threshold: float = 0.90
) -> Optional[SemanticCacheModel]:
    """
    Stores or updates a validated analytical synthesis in the semantic_cache table.
    """
    if db is None or intent != "qa_research" or not response_text or len(response_text.strip()) < 30:
        return None

    norm = normalize_query(query)
    embedding_vec = await generate_query_embedding(query, api_key=api_key, client=client)

    res = await db.execute(
        select(SemanticCacheModel)
        .where(SemanticCacheModel.query_norm == norm, SemanticCacheModel.intent_category == intent)
    )
    existing = res.scalar_one_or_none()

    if existing:
        existing.query_text = query
        existing.plan_json = plan
        existing.response_text = response_text
        existing.embedding_json = json.dumps(embedding_vec)
        existing.similarity_threshold = threshold
        existing.last_hit_at = get_utc_now()
        await db.commit()
        await db.refresh(existing)
        return existing

    new_entry = SemanticCacheModel(
        query_text=query,
        query_norm=norm,
        intent_category=intent,
        embedding_json=json.dumps(embedding_vec),
        plan_json=plan,
        response_text=response_text,
        similarity_threshold=threshold,
        hit_count=1,
        created_at=get_utc_now(),
        last_hit_at=get_utc_now()
    )
    db.add(new_entry)
    await db.commit()
    await db.refresh(new_entry)
    return new_entry
