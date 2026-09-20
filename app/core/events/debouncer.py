import asyncio
import logging
from typing import Dict, Any, Callable, Awaitable, Optional
from datetime import datetime, timezone

logger = logging.getLogger("cyclode.events.debouncer")


class EventDebouncer:
    """
    In-memory Event Debouncer & Burst Coalescer.
    Coalesces rapid webhook events targeting the same session_key (e.g. rapid git pushes,
    concurrent CI matrix check_runs) into a single rich dispatch to prevent agent race conditions.
    """

    def __init__(self, debounce_seconds: float = 2.5):
        self.debounce_seconds = debounce_seconds
        self._pending_timers: Dict[str, asyncio.TimerHandle] = {}
        self._pending_events: Dict[str, Dict[str, Any]] = {}
        self._dispatch_callbacks: Dict[str, Callable[[Dict[str, Any]], Awaitable[Any]]] = {}

    def submit_event(
        self,
        session_key: str,
        event_dict: Dict[str, Any],
        dispatch_callback: Callable[[Dict[str, Any]], Awaitable[Any]],
        immediate: bool = False
    ) -> bool:
        """
        Submits an event for debounced dispatching.
        If immediate=True or debounce_seconds <= 0, dispatches immediately via background task.
        Returns True if queued/dispatched.
        """
        if not session_key or immediate or self.debounce_seconds <= 0:
            asyncio.create_task(dispatch_callback(event_dict))
            return True

        loop = asyncio.get_running_loop()

        # Cancel existing timer for this session key if active
        if session_key in self._pending_timers:
            self._pending_timers[session_key].cancel()

        # Coalesce event payloads
        if session_key not in self._pending_events:
            self._pending_events[session_key] = event_dict
            self._dispatch_callbacks[session_key] = dispatch_callback
        else:
            existing = self._pending_events[session_key]
            # Merge commits, checks, or comments
            existing_payload = existing.get("payload", {})
            new_payload = event_dict.get("payload", {})

            # If both have commits, combine them
            if "commits" in existing_payload and "commits" in new_payload:
                existing_commits = existing_payload.get("commits", [])
                new_commits = new_payload.get("commits", [])
                existing_shas = {c.get("id") or c.get("sha") for c in existing_commits if isinstance(c, dict)}
                for c in new_commits:
                    if isinstance(c, dict) and (c.get("id") or c.get("sha")) not in existing_shas:
                        existing_commits.append(c)
                existing_payload["commits"] = existing_commits

            # Update latest head commit sha and title
            if event_dict.get("commit_sha"):
                existing["commit_sha"] = event_dict["commit_sha"]
            if event_dict.get("title"):
                existing["title"] = f"{existing.get('title', '')} + {event_dict.get('title')}"
            
            existing["coalesced_count"] = existing.get("coalesced_count", 1) + 1
            self._pending_events[session_key] = existing

        # Schedule new timer
        timer = loop.call_later(
            self.debounce_seconds,
            lambda sk=session_key: asyncio.create_task(self._flush_session(sk))
        )
        self._pending_timers[session_key] = timer
        return True

    async def _flush_session(self, session_key: str):
        """Flushes and dispatches coalesced event for session_key."""
        self._pending_timers.pop(session_key, None)
        event_dict = self._pending_events.pop(session_key, None)
        callback = self._dispatch_callbacks.pop(session_key, None)

        if event_dict and callback:
            try:
                logger.info(f"Debounced dispatch for session {session_key} (coalesced: {event_dict.get('coalesced_count', 1)})")
                await callback(event_dict)
            except Exception as e:
                logger.error(f"Error in debounced dispatch callback for {session_key}: {e}", exc_info=True)

    async def flush_all(self):
        """Immediately flushes all pending debounced sessions (useful for tests and shutdowns)."""
        keys = list(self._pending_events.keys())
        for k in keys:
            if k in self._pending_timers:
                self._pending_timers[k].cancel()
            await self._flush_session(k)


# Singleton debouncer instance
event_debouncer = EventDebouncer(debounce_seconds=2.5)
