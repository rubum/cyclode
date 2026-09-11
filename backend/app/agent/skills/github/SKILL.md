---
name: github
description: Enables the agent to inspect GitHub issues, create Git branches following conventions, and draft Pull Requests and comments.
---

# GitHub Workflow & Actions Guide

When resolving a GitHub issue or reviewing a Pull Request:

## 1. Branch Naming Conventions
- Bug fixes: `adappty/fix-issue-<number>`
- Features: `adappty/feat-<topic>`
- Refactors: `adappty/refactor-<topic>`

## 2. Pull Request Format
Always structure the PR body with:
- **Problem Summary**: Root cause identified.
- **Proposed Changes**: Files modified and rationale.
- **Verification**: Tests added or run to prove correctness.
- **Issue Reference**: `Fixes #<number>`.
