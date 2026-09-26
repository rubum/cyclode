import re
from typing import Dict, Any, Tuple
from app.integrations.manager import integration_manager


class VaultInterceptor:
    """
    Pre-processes incoming user prompts to discover and securely vault credentials
    (GitHub tokens, Slack tokens, Gemini API keys) while masking them in logs and downstream context.
    """

    GITHUB_TOKEN_REGEX = re.compile(r"\b(ghp_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{10,})\b")
    SLACK_TOKEN_REGEX = re.compile(r"\b(xoxb-[A-Za-z0-9-]+|xoxp-[A-Za-z0-9-]+)\b")
    GEMINI_KEY_REGEX = re.compile(r"\b(AIzaSy[A-Za-z0-9_-]{20,})\b")
    ANTHROPIC_KEY_REGEX = re.compile(r"\b(sk-ant-[A-Za-z0-9_-]{20,})\b")
    OPENAI_KEY_REGEX = re.compile(r"\b(sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{48,})\b")
    DEEPSEEK_KEY_REGEX = re.compile(r"\b(sk-(?!ant-|proj-)[a-f0-9]{32,}|sk-(?!ant-|proj-)[A-Za-z0-9_-]{30,})\b")
    LINEAR_KEY_REGEX = re.compile(r"\b(lin_api_[A-Za-z0-9_-]{20,})\b")

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

        # 4. Anthropic API Key
        anthropic_match = cls.ANTHROPIC_KEY_REGEX.search(prompt)
        if anthropic_match:
            raw_key = anthropic_match.group(1)
            extracted["anthropic_api_key"] = raw_key
            await integration_manager.update_credentials("anthropic", {"api_key": raw_key})
            sanitized = sanitized.replace(raw_key, integration_manager.mask_token(raw_key))

        # 5. OpenAI API Key
        openai_match = cls.OPENAI_KEY_REGEX.search(prompt)
        if openai_match:
            raw_key = openai_match.group(1)
            extracted["openai_api_key"] = raw_key
            await integration_manager.update_credentials("openai", {"api_key": raw_key})
            sanitized = sanitized.replace(raw_key, integration_manager.mask_token(raw_key))

        # 6. DeepSeek API Key
        deepseek_match = cls.DEEPSEEK_KEY_REGEX.search(prompt)
        if deepseek_match:
            raw_key = deepseek_match.group(1)
            extracted["deepseek_api_key"] = raw_key
            await integration_manager.update_credentials("deepseek", {"api_key": raw_key})
            sanitized = sanitized.replace(raw_key, integration_manager.mask_token(raw_key))

        # 7. Linear API Key
        linear_match = cls.LINEAR_KEY_REGEX.search(prompt)
        if linear_match:
            raw_key = linear_match.group(1)
            extracted["linear_api_key"] = raw_key
            await integration_manager.update_credentials("linear", {"api_key": raw_key})
            sanitized = sanitized.replace(raw_key, integration_manager.mask_token(raw_key))

        return sanitized, extracted
