import logging
from typing import List, Dict, Any, Optional

from app.agent.handlers.base import IntentContext, IntentHandler
from app.agent.handlers.vault_interceptor import VaultInterceptor
from app.agent.handlers.repo_handlers import (
    RepoConnectionHandler,
    URLSummarizeHandler,
    RepoAnalysisHandler,
    PRReviewHandler
)
from app.agent.handlers.intelligence_handlers import (
    WebIntelligenceHandler,
    AuthGuidanceHandler
)
from app.agent.handlers.dev_handlers import (
    CasualGreetingHandler,
    IdentityHandler,
    WorkspaceListingHandler,
    TestRunnerHandler,
    CodeReviewHandler,
    CommitVerificationHandler,
    TechnicalExampleHandler,
    FileInspectorHandler,
    CodingActionHandler
)

from app.agent.handlers.vector_router import SemanticVectorRouter

logger = logging.getLogger(__name__)


class IntentRegistry:
    """
    Registry of modular intent handlers for semantic fallback and offline agent execution.
    Combines strict structural checks (credentials, URLs) with high-speed local vector routing.
    """

    def __init__(self):
        self._handlers: List[IntentHandler] = [
            RepoConnectionHandler(),
            PRReviewHandler(),
            AuthGuidanceHandler(),
            RepoAnalysisHandler(),
            URLSummarizeHandler(),
            WebIntelligenceHandler(),
            CasualGreetingHandler(),
            IdentityHandler(),
            WorkspaceListingHandler(),
            TestRunnerHandler(),
            CodeReviewHandler(),
            CommitVerificationHandler(),
            TechnicalExampleHandler(),
            FileInspectorHandler(),
            CodingActionHandler(),
        ]
        self._vector_router = SemanticVectorRouter(self._handlers, min_confidence=0.20)

    async def dispatch(self, ctx: IntentContext) -> Dict[str, Any]:
        """
        Dispatches the context to the best matching handler using vector routing and fallback rules.
        """
        # Step 1: Strict structural matches (e.g. security credentials in extra, explicit connect command)
        for handler in self._handlers:
            if hasattr(handler, "matches_strict") and handler.matches_strict(ctx):
                logger.info(f"Dispatching intent to {handler.name} (strict match) for task '{ctx.title}'")
                return await handler.execute(ctx)

        # Step 2: High-confidence semantic vector routing
        routed = self._vector_router.route(ctx)
        if routed:
            handler, score = routed
            logger.info(f"Dispatching intent to {handler.name} (vector score: {score:.3f}) for task '{ctx.title}'")
            return await handler.execute(ctx)

        # Step 3: Heuristic matches() fallback
        for handler in self._handlers:
            try:
                if handler.matches(ctx):
                    logger.info(f"Dispatching intent to {handler.name} (heuristic match) for task '{ctx.title}'")
                    return await handler.execute(ctx)
            except Exception as e:
                logger.error(f"Error evaluating/executing handler {handler.name}: {e}", exc_info=True)
                continue

        # Fallback to default coding action handler if nothing matched
        logger.info(f"Fallback dispatching to CodingActionHandler for task '{ctx.title}'")
        return await CodingActionHandler().execute(ctx)


intent_registry = IntentRegistry()

__all__ = [
    "IntentContext",
    "IntentHandler",
    "VaultInterceptor",
    "SemanticVectorRouter",
    "IntentRegistry",
    "intent_registry",
]
