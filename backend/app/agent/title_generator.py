import re
import logging
from typing import Optional
import httpx

logger = logging.getLogger("adappty.title_generator")

# Common filler phrases to strip from start of requests
FILLER_PREFIXES = [
    r"^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?(?:help\s+(?:me\s+)?(?:to\s+)?)?",
    r"^(?:i\s+(?:want|need|would\s+like)\s+(?:you\s+)?(?:to\s+)?)?",
    r"^(?:how\s+(?:do\s+i|can\s+we|to)\s+)?",
    r"^(?:hey\s+(?:adappty|agent)?[\s,:-]*)?",
    r"^(?:look\s+at\s+)?",
]


def generate_heuristic_title(prompt: str, repo_name: Optional[str] = None) -> str:
    """
    Produces a clean, compact 3-6 word session title from a user prompt using
    smart regex parsing (stripping URLs, boilerplate, and extracting repository context).
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
        # Shorten text to 3-4 words and append repo
        words = clean_text.split(" ")[:4]
        combined = " ".join(words)
        candidate = f"{combined} ({extracted_repo})"
    else:
        # Take the first 5-6 words
        words = clean_text.split(" ")[:6]
        candidate = " ".join(words)

    # Clean trailing punctuation
    candidate = re.sub(r"[:;,.\-?!]+$", "", candidate).strip()

    if len(candidate) > 50:
        candidate = candidate[:47].rstrip() + "..."

    # Capitalize first letter cleanly
    if candidate:
        candidate = candidate[0].upper() + candidate[1:]

    return candidate or (f"Session: {extracted_repo}" if extracted_repo else "New Session")


async def generate_ai_title(
    prompt: str,
    repo_name: Optional[str] = None,
    api_key: Optional[str] = None
) -> Optional[str]:
    """
    Invokes Google Gemini API with a fast, lightweight call to generate a concise,
    professional 3 to 6 word session title. Falls back to None on quota, offline, or timeout.
    """
    # Resolve API key
    if not api_key:
        try:
            from app.config import settings
            from app.integrations.manager import integration_manager
            gemini_creds = integration_manager._custom_credentials.get("gemini", {})
            api_key = gemini_creds.get("api_key") or settings.get_api_key()
        except Exception:
            pass

    if not api_key:
        return None

    # Strip excessive length from prompt before sending
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

    request_payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            f"Generate a 3 to 5 word session title for this task:\n"
                            f"Request: {trimmed_prompt}\n"
                            f"Repository: {repo_name or 'None'}\n\n"
                            f"Title:"
                        )
                    }
                ]
            }
        ],
        "system_instruction": {
            "parts": [{"text": system_instruction}]
        },
        "generationConfig": {
            "maxOutputTokens": 20,
            "temperature": 0.2
        }
    }

    candidate_models = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-3.7-flash"]
    async with httpx.AsyncClient(timeout=8.0) as client:
        for model in candidate_models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            try:
                resp = await client.post(url, json=request_payload)
                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        raw_parts = candidates[0].get("content", {}).get("parts", [])
                        if raw_parts and "text" in raw_parts[0]:
                            title = raw_parts[0]["text"].strip()
                            # Clean surrounding quotes or markdown
                            title = re.sub(r'^["\'`#*]+|["\'`#*]+$', '', title).strip()
                            # Clean trailing periods or colons
                            title = re.sub(r'[:;.\-?!]+$', '', title).strip()
                            if 3 <= len(title) <= 65 and not title.lower().startswith("title:"):
                                return title
                elif resp.status_code in (404, 429):
                    continue
                else:
                    logger.debug(f"Title generator API notice ({resp.status_code}): {resp.text[:100]}")
            except Exception as e:
                logger.debug(f"Title generation error on {model}: {e}")
                continue

    return None
