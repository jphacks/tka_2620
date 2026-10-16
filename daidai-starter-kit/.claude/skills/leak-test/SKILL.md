---
name: leak-test
description: Run the scope leak test (at least 50 outsider attempts) and summarize the persona × scope visibility matrix
disable-model-invocation: true
---

Run `pnpm test:leak` and `pnpm test:redact`.

Report:
- attempts run per persona (the outsider x must have at least 50) and leaks found
- for each leak: persona, note id, and how it leaked (retrieval, answer text, inbox routing or canary string)
- the visibility matrix (persona × scope tier) as a small table
- redaction: synthetic chats and files added, items hidden by type, and any canary from `seed/chat-canaries.txt`
  found in a request body, LLM payload, note or log (must be none)

If leaks = 0, run `pnpm metrics` so the README numbers stay current.
If leaks > 0, propose a fix but don't apply it until asked.

$ARGUMENTS
