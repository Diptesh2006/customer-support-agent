# Evals for Customer Support Agent

This directory contains evaluation cases for the support agent, testing KB retrieval accuracy, guardrails, and fallback behavior.

## Usage

1. Build the library first:
   ```bash
   npm run build
   ```

2. Run the evals:
   ```bash
   KB_PATH=/path/to/kb.json NROUTER_API_KEY=sk-nrouter-... [EVAL_MODEL=...] node evals/run.mjs
   ```

Note: These evals require an API key and perform real gateway requests. They must not be run as part of the normal unit test suite.

To compare the unchanged RAG path with opt-in CAG on the same cold question set, build first and run:

```bash
KB_PATH=kb.json NROUTER_API_KEY=sk-nrouter-... node evals/compare-architectures.mjs
```

The comparison makes two live, billed passes. It reports keyword-based answer pass rate, p50/p95 end-to-end latency, context size, and exact priced-call cost. Keep the docs set, model, and dataset fixed between comparisons; CAG confidence is not directly comparable to RAG retrieval similarity.
