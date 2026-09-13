import math
import re
from collections import Counter, defaultdict
from typing import List, Dict, Any, Tuple, Optional
import logging

from app.agent.handlers.base import IntentContext, IntentHandler

logger = logging.getLogger(__name__)


class SemanticVectorRouter:
    """
    Zero-latency, in-process semantic vector space classifier for autonomous intent routing.
    Computes sub-word character/word N-gram TF-IDF embeddings and cosine similarity against
    handler exemplar clusters without requiring external cloud LLMs or heavyweight neural runtimes.
    """

    def __init__(self, handlers: Optional[List[IntentHandler]] = None, min_confidence: float = 0.22):
        self.handlers: List[IntentHandler] = handlers or []
        self.min_confidence = min_confidence
        self._vocab: Dict[str, int] = {}
        self._idf: Dict[str, float] = {}
        self._handler_centroids: Dict[str, Dict[int, float]] = {}
        self._handler_negative_centroids: Dict[str, Dict[int, float]] = {}
        self._exemplar_vectors: Dict[str, List[Dict[int, float]]] = {}
        self._is_indexed = False

        if self.handlers:
            self.index()

    def set_handlers(self, handlers: List[IntentHandler]) -> None:
        self.handlers = handlers
        self.index()

    def _tokenize(self, text: str) -> List[str]:
        """
        Extracts lowercase word tokens, word bi-grams, and character 3/4-grams for morphological robustness.
        """
        clean = re.sub(r"[^\w\s-]", " ", text.lower())
        words = [w for w in clean.split() if w]
        tokens = list(words)

        # Word bi-grams
        for i in range(len(words) - 1):
            tokens.append(f"{words[i]}_{words[i+1]}")

        # Sub-word character 3-grams and 4-grams for root/stemming resilience
        for w in words:
            if len(w) >= 3:
                for n in (3, 4):
                    for i in range(len(w) - n + 1):
                        tokens.append(f"#{w[i:i+n]}")

        return tokens

    def index(self) -> None:
        """
        Builds the TF-IDF vocabulary and precomputes L2-normalized exemplar centroids for all handlers.
        """
        doc_freq = Counter()
        total_docs = 0
        all_docs = []

        for handler in self.handlers:
            texts = [getattr(handler, "description", "")] + getattr(handler, "exemplars", [])
            for t in texts:
                if t:
                    tokens = set(self._tokenize(t))
                    doc_freq.update(tokens)
                    all_docs.append(tokens)
                    total_docs += 1

        # Vocabulary building
        self._vocab = {token: idx for idx, (token, _) in enumerate(doc_freq.items())}
        self._idf = {
            token: math.log((total_docs + 1.0) / (freq + 1.0)) + 1.0
            for token, freq in doc_freq.items()
        }

        # Precompute vectors for each handler
        self._handler_centroids.clear()
        self._handler_negative_centroids.clear()
        self._exemplar_vectors.clear()

        for handler in self.handlers:
            h_name = handler.name
            exemplars = getattr(handler, "exemplars", [])
            negatives = getattr(handler, "negative_exemplars", [])
            desc = getattr(handler, "description", "")

            # Exemplar vectors
            e_vecs = []
            for ex in exemplars:
                if ex:
                    vec = self._vectorize(ex)
                    if vec:
                        e_vecs.append(vec)

            if desc:
                d_vec = self._vectorize(desc)
                if d_vec:
                    e_vecs.append(d_vec)

            self._exemplar_vectors[h_name] = e_vecs

            # Compute positive centroid
            if e_vecs:
                centroid = defaultdict(float)
                for v in e_vecs:
                    for dim, val in v.items():
                        centroid[dim] += val
                # Normalize centroid
                self._handler_centroids[h_name] = self._normalize(dict(centroid))
            else:
                self._handler_centroids[h_name] = {}

            # Negative centroid
            n_vecs = []
            for neg in negatives:
                if neg:
                    v = self._vectorize(neg)
                    if v:
                        n_vecs.append(v)

            if n_vecs:
                neg_centroid = defaultdict(float)
                for v in n_vecs:
                    for dim, val in v.items():
                        neg_centroid[dim] += val
                self._handler_negative_centroids[h_name] = self._normalize(dict(neg_centroid))
            else:
                self._handler_negative_centroids[h_name] = {}

        self._is_indexed = True
        logger.info(f"SemanticVectorRouter indexed {len(self.handlers)} handlers across {len(self._vocab)} features.")

    def _vectorize(self, text: str) -> Dict[int, float]:
        """Converts text into an L2-normalized sparse TF-IDF feature dictionary."""
        tokens = self._tokenize(text)
        if not tokens:
            return {}

        tf = Counter(tokens)
        vec = {}
        for token, count in tf.items():
            if token in self._vocab:
                dim = self._vocab[token]
                idf = self._idf.get(token, 1.0)
                vec[dim] = (1.0 + math.log(count)) * idf

        return self._normalize(vec)

    def _normalize(self, vec: Dict[int, float]) -> Dict[int, float]:
        norm = math.sqrt(sum(v * v for v in vec.values()))
        if norm == 0:
            return {}
        return {k: v / norm for k, v in vec.items()}

    def _cosine_similarity(self, v1: Dict[int, float], v2: Dict[int, float]) -> float:
        """Computes dot product of two L2-normalized sparse vectors."""
        if not v1 or not v2:
            return 0.0
        # Iterate over the smaller dictionary
        if len(v1) > len(v2):
            v1, v2 = v2, v1
        return sum(val * v2[k] for k, val in v1.items() if k in v2)

    def rank(self, prompt: str) -> List[Tuple[IntentHandler, float]]:
        """
        Ranks all registered handlers by semantic similarity score against the prompt.
        """
        if not self._is_indexed:
            self.index()

        q_vec = self._vectorize(prompt)
        if not q_vec:
            return [(h, 0.0) for h in self.handlers]

        scored: List[Tuple[IntentHandler, float]] = []

        for handler in self.handlers:
            h_name = handler.name
            centroid = self._handler_centroids.get(h_name, {})
            neg_centroid = self._handler_negative_centroids.get(h_name, {})
            e_vecs = self._exemplar_vectors.get(h_name, [])

            # Centroid similarity
            c_sim = self._cosine_similarity(q_vec, centroid)

            # Max individual exemplar similarity
            max_e_sim = 0.0
            for ev in e_vecs:
                sim = self._cosine_similarity(q_vec, ev)
                if sim > max_e_sim:
                    max_e_sim = sim

            # Negative penalty
            neg_sim = self._cosine_similarity(q_vec, neg_centroid) if neg_centroid else 0.0

            # Combined base score
            base_score = (0.55 * c_sim + 0.45 * max_e_sim) - (0.6 * neg_sim)
            base_score = max(0.0, base_score)

            # Priority weight multiplier
            weight = getattr(handler, "priority_weight", 1.0)
            final_score = base_score * weight

            scored.append((handler, final_score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored

    def route(self, ctx: IntentContext) -> Optional[Tuple[IntentHandler, float]]:
        """
        Selects the best matching handler for the given IntentContext.
        """
        full_query = f"{ctx.title} {ctx.prompt}".strip()

        # Step 1: Explicit high-priority override check (e.g. security tokens in extra)
        for handler in self.handlers:
            try:
                if hasattr(handler, "matches_strict") and handler.matches_strict(ctx):
                    return handler, 1.0
            except Exception:
                pass

        # Step 2: Semantic vector ranking
        ranked = self.rank(full_query)
        if ranked:
            best_handler, best_score = ranked[0]
            if best_score >= self.min_confidence:
                return best_handler, best_score

        # Fallback to standard matches() if vector confidence is below threshold
        for handler in self.handlers:
            try:
                if handler.matches(ctx):
                    return handler, 0.5
            except Exception:
                pass

        return None
