import re
from typing import Dict, Any, Tuple
from app.integrations.manager import integration_manager


class VaultInterceptor:
    """
    Pre-processes incoming user prompts to discover and securely vault credentials
    (GitHub tokens, Slack tokens, Gemini API keys) while masking them in logs and downstream context.
    """

    GITHUB_TOKEN_REGEX = re.compile(r"(ghp_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{10,})")
    SLACK_TOKEN_REGEX = re.compile(r"(xoxb-[A-Za-z0-9-]+|xoxp-[A-Za-z0-9-]+)")
    GEMINI_KEY_REGEX = re.compile(r"(AIzaSy[A-Za-z0-9_-]{20,})")

    @classmethod
    async def process_prompt(cls, prompt: str) -> Tuple[str, Dict[str, Any]]:
        """
        Extracts credentials from the prompt, records them into integration_manager,
        and returns (sanitized_prompt, extracted_creds).
        """
        extracted = {}
        sanitized = prompt

        # 1. GitHub Token
        gh_match = cls.GITHUB_TOKEN_REGEX.search(prompt)
        if gh_match:
            raw_token = gh_match.group(1)
            extracted["github_token"] = raw_token
            await integration_manager.update_credentials("github", {"token": raw_token})
            sanitized = sanitized.replace(raw_token, integration_manager.mask_token(raw_token))

        # 2. Slack Token
        slack_match = cls.SLACK_TOKEN_REGEX.search(prompt)
        if slack_match:
            raw_token = slack_match.group(1)
            extracted["slack_token"] = raw_token
            await integration_manager.update_credentials("slack", {"token": raw_token})
            sanitized = sanitized.replace(raw_token, integration_manager.mask_token(raw_token))

        # 3. Gemini API Key
        gemini_match = cls.GEMINI_KEY_REGEX.search(prompt)
        if gemini_match:
            raw_key = gemini_match.group(1)
            extracted["gemini_api_key"] = raw_key
            await integration_manager.update_credentials("gemini", {"api_key": raw_key})
            sanitized = sanitized.replace(raw_key, integration_manager.mask_token(raw_key))

        return sanitized, extracted
