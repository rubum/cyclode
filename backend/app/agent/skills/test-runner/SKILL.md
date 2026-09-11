---
name: test-runner
description: Discovers repository test runners (pytest, jest, vitest, cargo test, go test) and verifies code changes before pull request generation.
---

# Test Runner Protocol

1. Detect test harness via manifests (package.json, pyproject.toml, pytest.ini).
2. Execute targeted unit tests matching modified files.
3. Report pass/fail assertion output with line references.
