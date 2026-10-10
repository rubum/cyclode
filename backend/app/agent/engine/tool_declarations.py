"""
Cyclode Agent Engine - Tool Declarations
Canonical tool schemas and definitions for AntigravityHarness and LLM providers.
"""

import copy
from typing import Dict, Any, List, Optional, Set

MUTATION_TOOL_NAMES: Set[str] = {
    "edit_file",
    "replace_file_content",
    "batch_replace_content",
    "apply_unified_patch",
    "revert_file",
    "speculative_branch_test",
}

ALL_TOOLS_DECLARATIONS = [
    {
        "function_declarations": [
            {
                "name": "list_dir",
                "description": "List files and subdirectories in the workspace.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "subpath": {"type": "STRING", "description": "Relative directory path (default: .)"}
                    }
                }
            },
            {
                "name": "read_file",
                "description": "Read file contents from the workspace. Prefer omitting start_line and end_line to inspect the full file in a single turn. Only specify start_line/end_line if the file is massive (>500KB).",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "file_path": {"type": "STRING", "description": "Relative path to file"},
                        "start_line": {"type": "INTEGER", "description": "Optional 1-indexed start line number"},
                        "end_line": {"type": "INTEGER", "description": "Optional 1-indexed end line number"}
                    },
                    "required": ["file_path"]
                }
            },
            {
                "name": "get_file_outline",
                "description": "Extracts AST class definitions, function signatures, endpoints, and types from a file without function bodies. Highly recommended for exploring unfamiliar files with minimal token consumption.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "file_path": {"type": "STRING", "description": "Relative path to file to outline"}
                    },
                    "required": ["file_path"]
                }
            },
            {
                "name": "replace_file_content",
                "description": "Replace a specific target text block with replacement content in an existing file. Token-efficient alternative to overwriting whole files with edit_file.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "file_path": {"type": "STRING", "description": "Relative path to file"},
                        "target_content": {"type": "STRING", "description": "Exact text block to replace"},
                        "replacement_content": {"type": "STRING", "description": "New replacement content"},
                        "allow_multiple": {"type": "BOOLEAN", "description": "Whether to replace multiple occurrences (default: false)"}
                    },
                    "required": ["file_path", "target_content", "replacement_content"]
                }
            },
            {
                "name": "batch_replace_content",
                "description": "Atomically apply multiple text replacements across one or more files in a single turn. Dramatically reduces roundtrips and token usage when modifying several files or multiple locations in a single file.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "edits": {
                            "type": "ARRAY",
                            "description": "List of file replacement operations to perform atomically",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "file_path": {"type": "STRING", "description": "Relative path to target file"},
                                    "target_content": {"type": "STRING", "description": "Exact target text block to find and replace"},
                                    "replacement_content": {"type": "STRING", "description": "New replacement text"},
                                    "allow_multiple": {"type": "BOOLEAN", "description": "Whether to replace multiple occurrences (default: false)"}
                                },
                                "required": ["file_path", "target_content", "replacement_content"]
                            }
                        }
                    },
                    "required": ["edits"]
                }
            },
            {
                "name": "apply_unified_patch",
                "description": "Apply a unified diff patch across multiple files atomically. Highly efficient for multi-hunk code transformations.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "patch_content": {"type": "STRING", "description": "Standard unified diff patch string (e.g. diff --git a/... b/...) "}
                    },
                    "required": ["patch_content"]
                }
            },
            {
                "name": "edit_file",
                "description": "Write or overwrite content of a file in the workspace. Set append=True to append content to the end of an existing file.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "file_path": {"type": "STRING", "description": "Relative path to file"},
                        "content": {"type": "STRING", "description": "New content to write or append to the file"},
                        "append": {"type": "BOOLEAN", "description": "Optional: If true, appends content to the end of the file instead of overwriting."}
                    },
                    "required": ["file_path", "content"]
                }
            },
            {
                "name": "run_command",
                "description": "Run shell command (e.g. pytest, npm test, git) in the workspace.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "command": {"type": "STRING", "description": "Shell command line"},
                        "cwd": {"type": "STRING", "description": "Optional subdirectory relative to workspace root (e.g. 'prs/pr-1258')"}
                    },
                    "required": ["command"]
                }
            },
            {
                "name": "speculative_branch_test",
                "description": "Execute parallel multi-branch testing across Copy-on-Write micro-sandbox forks in <10ms. Evaluates alternative code hypotheses simultaneously and identifies the winning fix.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "hypotheses": {
                            "type": "ARRAY",
                            "description": "List of alternative implementation hypotheses with file edits",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "name": {"type": "STRING", "description": "Hypothesis name (e.g. 'Use v4 CSS imports')"},
                                    "edits": {
                                        "type": "ARRAY",
                                        "items": {
                                            "type": "OBJECT",
                                            "properties": {
                                                "file_path": {"type": "STRING"},
                                                "target_content": {"type": "STRING"},
                                                "replacement_content": {"type": "STRING"}
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "test_command": {"type": "STRING", "description": "Verification shell command to run in each fork (e.g. 'npm run build' or 'pytest')"}
                    },
                    "required": ["hypotheses", "test_command"]
                }
            },
            {
                "name": "search_code",
                "description": "Fast workspace code search ignoring build & vendor folders, returning matching lines and file paths.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "query": {"type": "STRING", "description": "Search pattern or text"},
                        "is_regex": {"type": "BOOLEAN", "description": "Whether query is a regex pattern (default: false)"},
                        "file_pattern": {"type": "STRING", "description": "Optional file glob filter, e.g. '*.py' or 'src/**'"}
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "find_symbols",
                "description": "Locate functions, classes, interfaces, React components, and API route handlers across the workspace using AST indexing in 1 turn.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "name_pattern": {"type": "STRING", "description": "Substring or symbol name to look for (e.g. 'verify_signature')"},
                        "symbol_type": {"type": "STRING", "description": "Optional symbol filter: 'function', 'class', 'endpoint', 'component', 'interface', 'type'"},
                        "file_pattern": {"type": "STRING", "description": "Optional glob filter, e.g. '*.py' or '*.tsx'"}
                    }
                }
            },
            {
                "name": "tgrep_ast",
                "description": "Structural AST search matching syntax patterns (e.g. decorators '@app.post', class inheritance 'class:BaseModel', or functions).",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "pattern": {"type": "STRING", "description": "AST pattern to match, e.g. '@app.post', 'class:BaseModel', or symbol name"}
                    },
                    "required": ["pattern"]
                }
            },
            {
                "name": "search_web",
                "description": "Search the live web for tech news, documentation, APIs, and real-time releases.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "query": {"type": "STRING", "description": "Search query keywords"}
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "fetch_url",
                "description": "Fetch and extract clean text from a web URL.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "url": {"type": "STRING", "description": "Full HTTP/HTTPS URL"}
                    },
                    "required": ["url"]
                }
            },
            {
                "name": "get_pull_request_details",
                "description": "Fetch pull request metadata, description, base/head branches, mergeability status, CI check-runs conclusion, review verdicts, and list of modified files.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "repository": {"type": "STRING", "description": "Repository in owner/repo format (e.g. 'gowaylo/waylo')"},
                        "pr_number": {"type": "INTEGER", "description": "Pull request number"}
                    },
                    "required": ["repository", "pr_number"]
                }
            },
            {
                "name": "get_pull_request_checks",
                "description": "Fetch detailed CI check-runs, test workflow conclusions, and step details for a GitHub pull request.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "repository": {"type": "STRING", "description": "Repository in owner/repo format (e.g. 'gowaylo/waylo')"},
                        "pr_number": {"type": "INTEGER", "description": "Pull request number"}
                    },
                    "required": ["repository", "pr_number"]
                }
            },
            {
                "name": "get_pull_request_diff",
                "description": "Fetch the raw unified code diff for a specific GitHub pull request.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "repository": {"type": "STRING", "description": "Repository in owner/repo format (e.g. 'gowaylo/waylo')"},
                        "pr_number": {"type": "INTEGER", "description": "Pull request number"}
                    },
                    "required": ["repository", "pr_number"]
                }
            },
            {
                "name": "list_pull_requests",
                "description": "List pull requests in a GitHub repository.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "repository": {"type": "STRING", "description": "Repository in owner/repo format"},
                        "state": {"type": "STRING", "description": "PR state: 'open', 'closed', 'all' (default: 'open')"},
                        "author": {"type": "STRING", "description": "Optional author filter"},
                        "limit": {"type": "INTEGER", "description": "Maximum PRs to return (default: 10)"}
                    },
                    "required": ["repository"]
                }
            },
            {
                "name": "post_pull_request_review",
                "description": "Submit a concise, high-signal code review to a GitHub pull request. For clean PRs: 1-2 sentence LGTM confirming verified invariants. For PRs with bugs: lead immediately with '### Changes Requested (N blocking defects)' with exact file/line links, concrete root cause, and copy-pasteable diffs. Group non-blocking notes in <details><summary>Non-blocking Notes</summary>...</details>. NEVER write narrative filler, sycophantic praise, or diff recaps.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "repository": {"type": "STRING", "description": "Repository in owner/repo format (e.g. 'owner/repo')"},
                        "pr_number": {"type": "INTEGER", "description": "Pull request number"},
                        "body": {"type": "STRING", "description": "High-signal review Markdown (max 150 words total, zero fluff, defect-first with exact line links and copy-pasteable diffs)"},
                        "event": {"type": "STRING", "description": "Review action: 'COMMENT', 'APPROVE', 'REQUEST_CHANGES'"}
                    },
                    "required": ["repository", "pr_number", "body"]
                }
            },
            {
                "name": "post_pull_request_line_comment",
                "description": "Post a concise inline review comment on a specific line of code in a GitHub pull request diff. State the concrete defect and copy-pasteable diff. No narrative filler.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "repository": {"type": "STRING", "description": "Repository in owner/repo format"},
                        "pr_number": {"type": "INTEGER", "description": "Pull request number"},
                        "body": {"type": "STRING", "description": "Concise comment text with copy-pasteable diff (no conversational filler)"},
                        "commit_sha": {"type": "STRING", "description": "Head commit SHA"},
                        "path": {"type": "STRING", "description": "File path in repository"},
                        "line": {"type": "INTEGER", "description": "Diff line number"},
                        "side": {"type": "STRING", "description": "'LEFT' or 'RIGHT' (default: 'RIGHT')"}
                    },
                    "required": ["repository", "pr_number", "body", "commit_sha", "path", "line"]
                }
            },
            {
                "name": "create_pull_request",
                "description": "Create a new pull request on GitHub (supports draft PRs).",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "repository": {"type": "STRING", "description": "Repository in owner/repo format"},
                        "title": {"type": "STRING", "description": "Pull request title"},
                        "body": {"type": "STRING", "description": "Pull request description"},
                        "head_branch": {"type": "STRING", "description": "Source head branch"},
                        "base_branch": {"type": "STRING", "description": "Target base branch (default: main)"},
                        "draft": {"type": "BOOLEAN", "description": "Whether to create the pull request as a draft (default: false)"}
                    },
                    "required": ["repository", "title", "body", "head_branch"]
                }
            },
            {
                "name": "connect_repository",
                "description": "Connect a remote GitHub repository to Cyclode.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "repo_url": {"type": "STRING", "description": "GitHub repository clone URL"},
                        "token": {"type": "STRING", "description": "Optional GitHub personal access token"}
                    },
                    "required": ["repo_url"]
                }
            },
            {
                "name": "ask_user_inquiry",
                "description": "Ask the human user a structured multiple-choice inquiry or clarification question with predefined options and a default auto-proceed choice if the user does not respond within a timeout (e.g. app name, theme, features, architecture).",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "question": {"type": "STRING", "description": "The clear question to ask the human user"},
                        "options": {
                            "type": "ARRAY",
                            "description": "List of choice options formatted as objects with 'id', 'label', and optional 'description'",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "id": {"type": "STRING", "description": "Unique option identifier (e.g. 'opt_modern_dark')"},
                                    "label": {"type": "STRING", "description": "Short title of option"},
                                    "description": {"type": "STRING", "description": "Detailed explanation of this choice"}
                                },
                                "required": ["id", "label"]
                            }
                        },
                        "default_option_id": {"type": "STRING", "description": "ID of the recommended default option to auto-proceed with if the user doesn't respond in time"},
                        "timeout_seconds": {"type": "INTEGER", "description": "Seconds to wait before auto-proceeding with default (default: 25, min: 10, max: 120)"}
                    },
                    "required": ["question", "options", "default_option_id"]
                }
            },
            {
                "name": "verify_app_preview",
                "description": "Inspect and verify the live web application preview in the workspace. Checks whether an entry point exists (e.g. index.html, client/dist/index.html), whether scripts and assets resolve properly, whether Vite/React bundles have been compiled, and returns actionable feedback so you can fix errors before completing.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {}
                }
            },
            {
                "name": "run_verified_code_review",
                "description": "Executes the 4-stage verified review pipeline on a PR or code diff (Ensemble Scanners -> Adversarial Falsification -> Dedupe -> Actionable Diffs). Returns high-signal verified findings with guaranteed zero-style nitpicks.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "repository": {"type": "STRING", "description": "Optional repository in owner/repo format"},
                        "pr_number": {"type": "INTEGER", "description": "Optional pull request number"},
                        "diff_text": {"type": "STRING", "description": "Optional raw unified diff text to review"}
                    }
                }
            },
            {
                "name": "verify_code_hypothesis",
                "description": "Adversarially tests and falsifies a specific candidate issue or invariant violation hypothesis against local workspace files and AST.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "file_path": {"type": "STRING", "description": "Relative file path in workspace"},
                        "line_range": {"type": "STRING", "description": "Target line or line range (e.g. '42-48')"},
                        "invariant_violated": {"type": "STRING", "description": "Specific invariant or security/concurrency guarantee violated"},
                        "reproduction_scenario": {"type": "STRING", "description": "Concrete failure execution scenario"}
                    },
                    "required": ["file_path", "line_range", "invariant_violated"]
                }
            },
            {
                "name": "get_linear_issue",
                "description": "Fetch Linear issue details, title, description, team, state/status, priority, assignee, and comments by issue identifier (e.g. 'PD-1198', 'ENG-402').",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "issue_key": {"type": "STRING", "description": "Linear issue identifier or key (e.g. 'PD-1198', 'ENG-402')"}
                    },
                    "required": ["issue_key"]
                }
            },
            {
                "name": "search_linear_issues",
                "description": "Search for Linear issues and tickets matching a query string.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "query": {"type": "STRING", "description": "Search query or keywords"}
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "post_linear_comment",
                "description": "Post a comment or progress update to a Linear issue.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "issue_key": {"type": "STRING", "description": "Linear issue identifier (e.g. 'PD-1198') or issue ID"},
                        "comment": {"type": "STRING", "description": "Comment body in Markdown"}
                    },
                    "required": ["issue_key", "comment"]
                }
            },
            {
                "name": "update_linear_issue_status",
                "description": "Update or transition the state/status of a Linear issue.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "issue_key": {"type": "STRING", "description": "Linear issue identifier (e.g. 'PD-1198') or issue ID"},
                        "state_id": {"type": "STRING", "description": "Target workflow state name or UUID (e.g. 'In Progress', 'Done', 'In Review')"}
                    },
                    "required": ["issue_key", "state_id"]
                }
            },
            {
                "name": "list_linear_teams",
                "description": "List available Linear teams, their keys (e.g. 'PD'), workflow states, and labels.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {}
                }
            },
            {
                "name": "create_linear_issue",
                "description": "Create a new Linear issue in a team (e.g. 'PD') with optional title, description, priority, and state.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "title": {"type": "STRING", "description": "Issue title or summary"},
                        "team": {"type": "STRING", "description": "Linear team key or ID (defaults to 'PD')"},
                        "description": {"type": "STRING", "description": "Detailed issue description in Markdown"},
                        "priority": {"type": "INTEGER", "description": "Priority level: 0 (No priority), 1 (Urgent), 2 (High), 3 (Normal), 4 (Low)"},
                        "state": {"type": "STRING", "description": "Workflow state name or ID (e.g. 'Todo', 'In Progress', 'In Review')"}
                    },
                    "required": ["title"]
                }
            },
            {
                "name": "ingrations_search_tools",
                "description": "Searches for external software integrations, APIs, and tools across 16+ apps (e.g. Jira, Notion, Slack, Linear, GitHub, Sentry, AWS, Supabase, Cloudflare, Stripe). Returns matching action IDs, descriptions, and parameter schemas in sub-milliseconds.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "query": {"type": "STRING", "description": "Action keywords or tool capability (e.g. 'jira issue', 'slack message', 'notion search', 'sentry events', 'aws s3', 'stripe refund')"},
                        "category": {"type": "STRING", "description": "Optional category filter: 'devtools', 'productivity', 'cloud', 'crm_finance'"},
                        "limit": {"type": "INTEGER", "description": "Maximum number of tools to return (default: 5)"}
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "ingrations_execute",
                "description": "Executes an external software integration action discovered via ingrations_search_tools. Dispatches authenticated API request and returns structured result data.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "action_id": {"type": "STRING", "description": "The exact action identifier (e.g. 'jira.create_issue', 'slack.post_message', 'stripe.create_refund')"},
                        "params": {"type": "OBJECT", "description": "Dictionary of arguments matching the action's parameter specification"},
                        "dry_run": {"type": "BOOLEAN", "description": "Whether to simulate the request without modifying remote state (default: false)"}
                    },
                    "required": ["action_id"]
                }
            },
            {
                "name": "query_table",
                "description": "Parse and query tabular data files (CSV, TSV, JSONL, Parquet) with column statistics, filtering, sorting, or custom SQL queries on the in-memory 'data_table'.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "file_path": {"type": "STRING", "description": "Relative path to CSV, TSV, JSONL, or Parquet file"},
                        "sql_query": {"type": "STRING", "description": "Optional SQL SELECT query against 'data_table' (e.g. 'SELECT * FROM data_table WHERE age > 30 ORDER BY score DESC')"},
                        "filter_query": {"type": "STRING", "description": "Optional substring filter to search across all rows and cells"},
                        "sort_col": {"type": "STRING", "description": "Optional column name to sort by"},
                        "sort_dir": {"type": "STRING", "description": "'asc' or 'desc' (default: 'asc')"},
                        "page": {"type": "INTEGER", "description": "Page number (default: 1)"},
                        "page_size": {"type": "INTEGER", "description": "Page size (default: 50)"}
                    },
                    "required": ["file_path"]
                }
            },
            {
                "name": "inspect_archive",
                "description": "Safely inspect the contents and hierarchy of an archive file (.zip, .tar, .tar.gz, .tgz, .tar.bz2) in memory without disk extraction.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "file_path": {"type": "STRING", "description": "Relative path to archive file"}
                    },
                    "required": ["file_path"]
                }
            },
            {
                "name": "view_image",
                "description": "Inspect and visually analyze an image file (PNG, JPG, WEBP, GIF, SVG) in the workspace or attachments. Returns dimensions, format, layout structure, and rich OCR/visual scene analysis.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "file_path": {"type": "STRING", "description": "Relative path to image file (e.g. .cyclode/attachments/screenshot.png or static/logo.png)"},
                        "prompt": {"type": "STRING", "description": "Optional specific question or focus for visual inspection (e.g. 'Read the error message and UI buttons from this screenshot')"}
                    },
                    "required": ["file_path"]
                }
            },
            {
                "name": "delegate_subtasks",
                "description": "Dispatches concurrent subagent tasks linked to the current parent session. Enables multi-agent swarms (e.g. parallel PR reviews, specialist security/QA audits, speculative branches, partitioned file migrations) with live telemetry in the Agents tab.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "subtasks": {
                            "type": "ARRAY",
                            "description": "List of subtasks to execute concurrently (max 5)",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "title": {"type": "STRING", "description": "Short descriptive title of the subtask"},
                                    "prompt": {"type": "STRING", "description": "Detailed instructions and objective for the subagent"},
                                    "persona": {"type": "STRING", "description": "Persona to run (e.g. 'TradeAnalyst', 'CodeReviewer', 'SecurityAuditor', 'SoftwareEngineer', 'TestEngineer')"},
                                    "role_definition": {"type": "STRING", "description": "Optional 1-sentence role title for custom persona (e.g. 'Quantitative Commodities & Trade Analyst')"},
                                    "persona_instructions": {"type": "STRING", "description": "Optional custom system prompt defining domain directives, methodologies, and analytical guidelines"},
                                    "model_name": {"type": "STRING", "description": "Optional model name override (e.g. 'gemini-3.7-flash', 'deepseek-chat')"},
                                    "session_key": {"type": "STRING", "description": "Optional session grouping key (e.g. 'pr-42', 'auth-spec')"},
                                    "repo_name": {"type": "STRING", "description": "Optional repository handle"}
                                },
                                "required": ["title", "prompt"]
                            }
                        },
                        "clear_existing": {
                            "type": "BOOLEAN",
                            "description": "Whether to clear prior subagents (both active and completed) before launching this swarm wave. Defaults to true to avoid idle pod accumulation."
                        },
                        "wait_for_completion": {
                            "type": "BOOLEAN",
                            "description": "Whether to wait synchronously for all subagents to finish and aggregate results (default: true)"
                        }
                    },
                    "required": ["subtasks"]
                }
            },
            {
                "name": "send_subagent_message",
                "description": "Sends a follow-up instruction or message to an existing subagent pod by subagent_id or session_key, resuming its conversation and state in its workspace without spawning a duplicate pod.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "message": {"type": "STRING", "description": "The follow-up prompt or instruction for the subagent"},
                        "subagent_id": {"type": "STRING", "description": "Optional subagent task ID to target"},
                        "session_key": {"type": "STRING", "description": "Optional session grouping key to target (e.g. 'pr-42', 'auth-spec')"},
                        "wait_for_completion": {"type": "BOOLEAN", "description": "Whether to wait synchronously for the subagent turn to complete (default: true)"}
                    },
                    "required": ["message"]
                }
            },
            {
                "name": "batch_review_prs",
                "description": "Spawns dedicated CodeReviewer subagents for multiple GitHub pull requests in parallel. Automatically creates isolated worktrees, executes linters and unit tests, and returns consolidated review summaries.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "repository": {"type": "STRING", "description": "Repository handle (e.g. 'owner/repo')"},
                        "pr_numbers": {
                            "type": "ARRAY",
                            "description": "List of pull request numbers to review concurrently",
                            "items": {"type": "INTEGER"}
                        },
                        "wait_for_completion": {
                            "type": "BOOLEAN",
                            "description": "Whether to wait synchronously for all reviews to finish (default: true)"
                        }
                    },
                    "required": ["repository", "pr_numbers"]
                }
            },
            {
                "name": "apply_subagent_diff",
                "description": "Atomically adopts and applies code changes/diffs produced by a completed subagent into the primary workspace. Ideal for adopting the winning approach from a speculative tournament or merging partitioned work.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "subagent_task_id": {"type": "STRING", "description": "Task ID of the subagent whose diff should be merged"}
                    },
                    "required": ["subagent_task_id"]
                }
            },
            {
                "name": "get_subagent_results",
                "description": "Retrieves live status, active tools, results, and diff summaries for specified subagent task IDs.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "subagent_task_ids": {
                            "type": "ARRAY",
                            "description": "List of subagent task IDs to query",
                            "items": {"type": "STRING"}
                        }
                    },
                    "required": ["subagent_task_ids"]
                }
            }
        ]
    }
]


def get_all_tool_declarations() -> List[Dict[str, Any]]:
    """Returns a deep copy of all tool declaration schemas."""
    return copy.deepcopy(ALL_TOOLS_DECLARATIONS)


def filter_declarations_for_intent(
    tools_declarations: Optional[List[Dict[str, Any]]],
    intent_category: str,
    is_capability_enabled_fn=None,
) -> Optional[List[Dict[str, Any]]]:
    """
    Filters tool function declarations based on intent category and capability flags.
    """
    if not tools_declarations:
        return None

    def _is_allowed(decl: Dict[str, Any], excluded_set: Set[str]) -> bool:
        name = decl.get("name", "")
        if name in excluded_set:
            return False
        if is_capability_enabled_fn and not is_capability_enabled_fn(name):
            return False
        return True

    if intent_category in ("qa_research", "planning"):
        excluded = MUTATION_TOOL_NAMES
    else:
        excluded = set()

    filtered = [
        {
            "function_declarations": [
                d for d in t.get("function_declarations", [])
                if _is_allowed(d, excluded)
            ]
        }
        for t in tools_declarations
    ]
    return filtered
