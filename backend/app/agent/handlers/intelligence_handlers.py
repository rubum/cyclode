import re
import logging
from typing import Dict, Any, List
from app.agent.handlers.base import IntentContext, IntentHandler
from app.agent.tools import WorkspaceTools

logger = logging.getLogger(__name__)


class WebIntelligenceHandler(IntentHandler):
    name = "WebIntelligenceHandler"
    description = "Searches the live web for tech news, company acquisitions, AI model releases, financial deals, and real-time developer ecosystem intelligence."
    exemplars = [
        "search the web for tech news today",
        "what happened today in tech",
        "what happened this week at nvidia",
        "huggingface news today",
        "explain this Nvidia agrees to acquire Hugging Face for $13B",
        "explain this Stripe buys Bridge for $1.1B",
        "tell me about the recent OpenAI partnership",
        "search news on Stripe buying Bridge",
        "what are the latest AI announcements this month",
        "summarize what happened with Databricks acquiring Tabular",
        "latest breaking tech news",
        "search for recent updates on Apple intelligence",
        "what is new in AI this week",
        "explain the Google Anthropic cloud deal"
    ]
    negative_exemplars = [
        "explain this repository",
        "what is in this codebase",
        "how do i get a github token",
        "run pytest on this project",
        "analyze workspace architecture"
    ]
    priority_weight = 1.25

    def matches(self, ctx: IntentContext) -> bool:
        lower = ctx.lower_prompt
        if any(w in lower for w in ("in this repo", "in the repo", "in this workspace", "in this codebase", "in this project")):
            return False

        tech_entities = r"(?:nvidia|hugging\s*face|openai|anthropic|google|apple|meta|microsoft|amazon|deepseek|mistral|xai|tech|ai)"
        action_terms = r"(?:acquire|acquires|acquisition|buy|buys|bought|announcement|announces|release|releases|partnership|partner|deal|merger|sec filing|ipo)"

        return bool(
            re.search(rf"\b(search (?:the )?web|search (?:for )?news|tech news|ai news|{tech_entities}\s+news)\b", lower)
            or re.search(rf"\b(what (?:happened|is new|is happening)|provide a summary of (?:what happened|news|developments|announcements))\b.*\b(today|this week|this month|recently|recent|{tech_entities})\b", lower)
            or re.search(r"\b(any news|latest news|breaking news|recent news|news on|updates on|what happened at)\b", lower)
            or re.search(rf"\b(explain\s+(?:this\s+)?|summarize\s+(?:this\s+)?|tell\s+me\s+about\s+(?:this\s+)?|what\s+about\s+|what\s+is\s+this\s+)?{tech_entities}\b.*\b{action_terms}\b", lower)
            or any(w in lower for w in (
                "what was the tech on today", "what happened today in tech", "what happened this week at nvidia",
                "huggingface news today", "search for tech news today", "tech news today", "latest ai news",
                "what's new in tech", "what is new in tech", "what happened in tech", "what happened this week",
                "what happened this month", "summary of what happened", "provide a summary of what happened",
                "nvidia news", "huggingface news", "ai news", "apple news"
            ))
        )

    async def execute(self, ctx: IntentContext) -> Dict[str, Any]:
        lower = ctx.lower_prompt
        # 1. Clean leading conversational questions
        clean_prompt = re.sub(
            r"^(?:what\s+is\s+happening\s+(?:at|with|in|to)\s+|what\s+happened\s+(?:at|with|in|to)\s+|what\s+is\s+new\s+(?:at|with|in)\s+|what\'s\s+new\s+(?:at|with|in)\s+|tell\s+me\s+about\s+|explain\s+(?:this\s+)?|summarize\s+(?:this\s+)?|search\s+(?:the\s+)?(?:web\s+)?(?:for\s+)?(?:news\s+)?(?:about\s+)?|news\s+(?:on|about)\s+)",
            "",
            ctx.prompt,
            flags=re.IGNORECASE
        ).strip()

        # 2. Clean trailing temporal and qualifier phrases
        months_pat = r"january|february|march|april|may|june|july|august|september|october|november|december"
        clean_prompt = re.sub(
            rf"(?:,\s*)?(?:esp(?:ecially)?\s+)?(?:the\s+)?(?:last|recent|past)?\s*(?:today|yesterday|tonight|this\s+morning|this\s+week|this\s+month|this\s+year|last\s+weeks?|last\s+months?|last\s+days?|last\s+year|now|currently|recent|recently|latest|news|updates|announcements|2023|2024|2025|2026|{months_pat})\s*$",
            "",
            clean_prompt,
            flags=re.IGNORECASE
        ).strip()
        clean_prompt = re.sub(r"^(?:at|with|about|for|in|on|to)\s+", "", clean_prompt).strip()
        clean_prompt = re.sub(r"\s+", " ", clean_prompt).strip()

        search_query = clean_prompt if len(clean_prompt.split()) >= 1 and len(clean_prompt) >= 2 else ctx.prompt

        CANONICAL_NAMES = {
            "spacex": "SpaceX",
            "openai": "OpenAI",
            "github": "GitHub",
            "huggingface": "Hugging Face",
            "hugging face": "Hugging Face",
            "cursor": "Cursor",
            "deepseek": "DeepSeek",
            "chatgpt": "ChatGPT",
            "ios": "iOS",
            "macos": "macOS",
        }
        topic_title = CANONICAL_NAMES.get(search_query.lower(), search_query.title())

        await ctx.emit_thought(f"Detected real-time ecosystem query. Executing live retrieval for '{search_query}'...")
        await ctx.call_tool_start("search_web", {"query": search_query})
        search_res = await WorkspaceTools.search_web(search_query, limit=5, temporal_context=ctx.prompt)
        results = search_res.get("results", [])

        tool_output_str = "\n".join(
            f"- [{r.get('title')}]({r.get('url')}) • {r.get('source')} • {r.get('date')}"
            if r.get('date') else
            f"- [{r.get('title')}]({r.get('url')}) • {r.get('source')}"
            for r in results
        ) if results else "No direct records found"
        await ctx.call_tool_end("search_web", tool_output_str, 0, 280)

        if results:
            synthesized_items = []
            for r in results:
                t = r.get('title', '').replace('|', '-')
                u = r.get('url', '')
                s = r.get('source', 'Community Discussion')
                d = r.get('date', '')
                date_suffix = f" *({d})*" if d else ""
                
                # Contextual category tag
                lower_t = t.lower()
                if any(k in lower_t for k in ("security", "attack", "pwned", "vulnerability", "cve", "breach", "hack")):
                    category = "Security & Research"
                elif any(k in lower_t for k in ("support", "policy", "cancellation", "lockout", "pricing", "terms", "ban")):
                    category = "Product & Account Policies"
                elif any(k in lower_t for k in ("camp", "conference", "summit", "meetup", "hackathon", "event")):
                    category = "Events & Community"
                elif any(k in lower_t for k in ("acquire", "acquisition", "buy", "buys", "bought", "valuation", "fund", "raise", "ipo", "$")):
                    category = "M&A & Ecosystem"
                elif any(k in lower_t for k in ("release", "v0", "v1", "v2", "update", "launch", "announc", "feature")):
                    category = "Releases & Features"
                else:
                    category = "Developer Discussion"
                
                synthesized_items.append(f"* **{category}**: [{t}]({u}){date_suffix}")

            highlights_md = "\n".join(synthesized_items)
            briefing_md = (
                f"Looking at recent community discussions and ecosystem developments around **{topic_title}**, here are the key highlights and updates:\n\n"
                f"{highlights_md}\n\n"
                f"*(Discussions and coverage sourced directly from developer feeds and live community tracking.)*"
            )
        else:
            briefing_md = (
                f"I checked live developer feeds for recent news and discussions regarding **{topic_title}**, but no verified stories were returned under current parameters.\n\n"
                f"You can try searching with broader keywords or checking direct project repositories."
            )

        await ctx.emit_message("agent", briefing_md)
        return {"status": "COMPLETED", "summary": f"Fetched web intelligence for {search_query}."}


class AuthGuidanceHandler(IntentHandler):
    name = "AuthGuidanceHandler"
    description = "Provides step-by-step instructions on generating, locating, and configuring GitHub Personal Access Tokens (PAT), API credentials, and authentication keys."
    exemplars = [
        "how do i get a github token",
        "where do i find my personal access token",
        "how to create a token for private repo",
        "where to generate github pat",
        "how do i get credentials to connect repository",
        "how do i get that token",
        "where do i get a token from",
        "explain how to make a classic github token"
    ]
    negative_exemplars = [
        "what is in this repo https://github.com/...",
        "analyze repository https://github.com/...",
        "connect to repository https://github.com/...",
        "what is this project https://github.com/...",
        "explain this repo",
        "run pytest suite"
    ]
    priority_weight = 1.1

    def matches(self, ctx: IntentContext) -> bool:
        lower = ctx.lower_prompt
        # Exclude prompts containing URLs or repo analysis queries
        if "http://" in lower or "https://" in lower or "github.com/" in lower:
            return False
        if any(w in lower for w in ("analyse", "analyze", "explain repo", "what is this project", "inspect")):
            return False

        return bool(
            re.search(r"\b(token|pat|api[_-]?key|personal access token|ghp|credentials)\b.*\b(where|how|get|find|create|generate|make|obtain|source|from|need)\b", lower)
            or re.search(r"\b(where|how|what)\b.*\b(token|pat|api[_-]?key|personal access token|credentials)\b", lower)
            or any(w in lower for w in (
                "how do i get that", "how do i get a token", "how to get token", "how do i get it",
                "create a token", "generate token", "where do i get a token", "personal access token",
                "github token help", "where to get token", "how to generate a token", "how to get a pat",
                "token from where", "where token", "what token", "token help"
            ))
        )

    async def execute(self, ctx: IntentContext) -> Dict[str, Any]:
        token_help_md = (
            "### 🔑 How to Generate a GitHub Personal Access Token (PAT)\n\n"
            "To access private repositories with Cyclode, you can generate a token in 4 quick steps:\n\n"
            "1. **Open GitHub Token Settings**:\n"
            "   - Go directly to [https://github.com/settings/tokens](https://github.com/settings/tokens) (or click your profile icon in GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic)**).\n\n"
            "2. **Create New Token**:\n"
            "   - Click **Generate new token** and choose **Generate new token (classic)**.\n"
            "   - Add a note/name (e.g. `Cyclode Workstation`) and set an expiration (e.g. 30 days).\n\n"
            "3. **Select Repository Scope**:\n"
            "   - Check ✅ **`repo`** (Full control of private repositories: `repo:status`, `repo_deployment`, `public_repo`, `repo:invite`, `security_events`).\n\n"
            "4. **Paste Your Token Here in Chat**:\n"
            "   - Click **Generate token** at the bottom of the page.\n"
            "   - Copy the generated `ghp_...` string and paste it right here in this chat!\n\n"
            "> 🔒 *Your token will be automatically masked in the UI and securely saved for this session. Once provided, I'll immediately clone your repository and proceed.*"
        )
        await ctx.emit_message("agent", token_help_md)
        return {"status": "AWAITING_INPUT", "summary": "Provided step-by-step GitHub token generation instructions."}
