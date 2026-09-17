---
name: git-worktree
description: Isolates task execution in ephemeral git worktrees without interfering with the primary branch or ongoing tasks.
---

# Git Worktree Isolation Guide

1. Each task receives an isolated ephemeral workspace branch under `/workspaces/worktrees/<task_id>`.
2. Clean up or prune worktrees when tasks complete.
