import re
import logging
from typing import Optional
import httpx

logger = logging.getLogger("cyclode.title_generator")

# Common filler phrases to strip from start of requests
FILLER_PREFIXES = [
    r"^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?(?:help\s+(?:me\s+)?(?:to\s+)?)?",
    r"^(?:i\s+(?:want|need|would\s+like)\s+(?:you\s+)?(?:to\s+)?)?",
    r"^(?:how\s+(?:do\s+i|can\s+we|to)\s+)?",
    r"^(?:hey\s+(?:cyclode|agent)?[\s,:-]*)?",
    r"^(?:look\s+at\s+)?",
]


TRAILING_STOPWORDS = {
    "for", "to", "in", "with", "and", "of", "on", "at", "by", "from",
    "a", "an", "the", "as", "is", "are", "into", "or", "about", "using", "via"
}


def generate_heuristic_title(prompt: str, repo_name: Optional[str] = None) -> str:
    """
    Produces a clean, compact 3-8 word session title from a user prompt using
    smart regex parsing (stripping URLs, boilerplate, and extracting repository context).
    Guarantees complete intent preservation without dangling trailing prepositions.
    """
    if not prompt or not prompt.strip():
        return f"Session: {repo_name}" if repo_name else "New Session"

    raw_text = prompt.strip()

    # Extract repository name from GitHub URLs if not explicitly provided
    extracted_repo = repo_name
    gh_match = re.search(r"https?://github\.com/[A-Za-z0-9_.-]+/([A-Za-z0-9_.-]+)", raw_text, re.IGNORECASE)
    if gh_match:
        extracted_repo = gh_match.group(1).replace(".git", "")

    # Strip URLs
    clean_text = re.sub(r"https?://\S+", "", raw_text)

    # Strip markdown headers or code symbols
    clean_text = re.sub(r"^[#*`>\-\s]+", "", clean_text)

    # Strip common leading filler phrases
    for pat in FILLER_PREFIXES:
        clean_text = re.sub(pat, "", clean_text, flags=re.IGNORECASE).strip()

    # Clean redundant whitespace
    clean_text = re.sub(r"\s+", " ", clean_text).strip()

    # If text is empty after stripping URLs (user just pasted a repo link)
    if not clean_text:
        return f"Explore {extracted_repo}" if extracted_repo else "Repository Analysis"

    # If repository was extracted and not already mentioned in text
    if extracted_repo and extracted_repo.lower() not in clean_text.lower():
        words = clean_text.split(" ")
        # Shorten prefix to 3 words to accommodate repository tag
        combined = " ".join(words[:3])
        # Strip trailing stopwords from combined prefix before appending repo
        p_words = combined.split(" ")
        while len(p_words) > 1 and p_words[-1].lower() in TRAILING_STOPWORDS:
            p_words.pop()
        combined = " ".join(p_words)
        candidate = f"{combined} ({extracted_repo})"
    else:
        words = clean_text.split(" ")
        if len(words) <= 8 and len(clean_text) <= 55:
            candidate = clean_text
        else:
            # Take up to 7-8 words that fit within 52 chars
            picked = []
            cur_len = 0
            for w in words[:8]:
                if cur_len + len(w) + 1 > 50 and picked:
                    break
                picked.append(w)
                cur_len += len(w) + 1
            candidate = " ".join(picked)

    # Clean trailing punctuation
    candidate = re.sub(r"[:;,.\-?!]+$", "", candidate).strip()

    # Strip trailing stopwords / prepositions (e.g. "Build app for" -> "Build app")
    c_words = candidate.split(" ")
    while len(c_words) > 1 and c_words[-1].lower() in TRAILING_STOPWORDS:
        c_words.pop()
    candidate = " ".join(c_words)

    # Clean trailing punctuation again if any remained after popping
    candidate = re.sub(r"[:;,.\-?!]+$", "", candidate).strip()

    if len(candidate) > 55:
        candidate = candidate[:52].rstrip() + "..."

    # Capitalize first letter cleanly
    if candidate:
        candidate = candidate[0].upper() + candidate[1:]

    return candidate or (f"Session: {extracted_repo}" if extracted_repo else "New Session")


async def generate_ai_title(
    prompt: str,
    repo_name: Optional[str] = None,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None
) -> Optional[str]:
    """
    Invokes the active AI model provider with a fast, lightweight call to generate a concise,
    professional 3 to 6 word session title. Falls back gracefully on quota, offline, or timeout.
    """
    from app.config import settings
    from app.agent.providers.factory import get_provider_for_model

    provider = get_provider_for_model(model_name or settings.ANTIGRAVITY_MODEL)
    if api_key and hasattr(provider, "_api_key"):
        provider._api_key = api_key
    
    # Check if active provider has a configured key, otherwise try alternatives
    if not provider.get_api_key():
        from app.agent.providers.gemini import GeminiProvider
        from app.agent.providers.deepseek import DeepSeekProvider
        from app.agent.providers.claude import ClaudeProvider
        from app.agent.providers.openai import OpenAIProvider

        for cand_prov in [GeminiProvider(), DeepSeekProvider(), ClaudeProvider(), OpenAIProvider()]:
            if cand_prov.get_api_key():
                provider = cand_prov
                break

    if not provider.get_api_key():
        return None

    trimmed_prompt = prompt[:400].strip()
    system_instruction = (
        "You are an AI session title generator for a software engineering workstation. "
        "Generate a short, concise, and descriptive session title (3 to 6 words maximum) "
        "capturing the core intent, action, and repository or component. "
        "STRICT RULES:\n"
        "1. Never output quotation marks, backticks, or markdown formatting.\n"
        "2. Never output full URLs or file paths.\n"
        "3. Output ONLY the title itself, nothing else.\n"
        "4. Examples:\n"
        "- 'Analyse https://github.com/open-telemetry/opentelemetry-python and explain tracing' -> OpenTelemetry Tracing Analysis\n"
        "- 'Fix null pointer exception in auth service login handler' -> Fix Auth Service NPE\n"
        "- 'How do I configure docker compose for local postgres?' -> Docker Compose Postgres Setup"
    )

    user_text = (
        f"Generate a 3 to 5 word session title for this task:\n"
        f"Request: {trimmed_prompt}\n"
        f"Repository: {repo_name or 'None'}\n\n"
        f"Title:"
    )

    async with httpx.AsyncClient(timeout=8.0) as client:
        # Determine candidate models based on provider
        if provider.provider_id == "deepseek":
            cand_models = ["deepseek-flash", "deepseek-chat"]
        elif provider.provider_id == "anthropic":
            cand_models = ["claude-3-5-haiku-20241022", "claude-3-5-sonnet-20241022"]
        elif provider.provider_id == "openai":
            cand_models = ["gpt-4o-mini", "gpt-4o"]
        else:
            cand_models = ["gemini-3.7-flash", "gemini-3.8-flash"]

        for model in cand_models:
            try:
                resp = await provider.generate_response(
                    messages=[{"role": "user", "parts": [{"text": user_text}]}],
                    tools=None,
                    system_instruction=system_instruction,
                    model_name=model,
                    client=client
                )
                if resp.is_success and resp.content:
                    title = resp.content.strip()
                    title = re.sub(r'^["\'`#*]+|["\'`#*]+$', '', title).strip()
                    title = re.sub(r'[:;.\-?!]+$', '', title).strip()
                    if 3 <= len(title) <= 65 and not title.lower().startswith("title:"):
                        return title
            except Exception as e:
                logger.debug(f"Title generation error on {model}: {e}")
                continue

    return None

