---
name: sentry
description: Enables the agent to fetch Sentry issue stack traces, inspect breadcrumbs, and correlate production exceptions with workspace source code.
---

# Sentry APM & Issue Triage Guide

When investigating a Sentry issue:
1. Inspect the stack trace top frame and correlate with workspace file paths.
2. Examine breadcrumbs for request parameters, user events, and database queries preceding the crash.
3. Formulate minimal reproduction unit test before applying fixes.
