---
name: linear
description: Inspects Linear issues, updates issue status, and posts progress comments using native vaulted credentials.
---

# Linear Issue Tracking & Automation Skill

This skill provides native tools for autonomous agents to interact directly with Linear issues, teams, and workflows without requiring manual terminal scripts or token extraction.

## Available Agent Tools

1. **`get_linear_issue(issue_key: str)`**:
   - Fetches full ticket details, markdown description, comments, assignee, priority, and workflow state.
   - Example issue key: `"PD-1198"`, `"ENG-402"`, `"SEC-12"`.

2. **`search_linear_issues(query: str)`**:
   - Searches Linear tickets matching title or body queries.

3. **`post_linear_comment(issue_key: str, comment: str)`**:
   - Posts a structured markdown comment or resolution update to the issue.

4. **`update_linear_issue_status(issue_key: str, state_id: str)`**:
   - Transitions an issue to a new workflow state (e.g., `'In Progress'`, `'Done'`, `'In Review'`).

## Best Practices

- Always query `get_linear_issue` when a user prompt or review references a ticket identifier (e.g. `PD-1198`) to extract original acceptance criteria and reproduction steps.
- When resolving a task linked to an issue, post a summary comment detailing the fix and relevant pull request links.
