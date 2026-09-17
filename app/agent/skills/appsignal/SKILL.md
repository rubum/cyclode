---
name: appsignal
description: Enables the agent to parse AppSignal exception backtraces, match trace lines to local files, and draft reproduction tests.
---

# AppSignal APM Triage Guidelines

When analyzing an AppSignal error incident:
1. Examine the top stack frame to identify the faulty file and line number.
2. Read the surrounding code context.
3. Write a reproduction unit test before applying the bug fix.
4. Verify the test suite passes before submitting the resolution.
