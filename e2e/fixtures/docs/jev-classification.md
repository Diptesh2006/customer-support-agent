# Jev Classification in nRouter

Jev (`typesafe/jev`) is nRouter's primary autonomous intent and task-type classification model. It powers intelligent routing in `nrouter/auto` and autonomous catalog verification in System One model vetting.

## Autonomous Task & Intent Routing (`nrouter/auto`)

When requests are sent to the smart router alias `nrouter/auto`, nRouter uses Jev-powered classification by default:
- **Default Classification:** Jev classification is active across every organization by default.
- **Fast Decision Boundary:** Classifies incoming prompts in sub-400ms into canonical task categories:
  - `code`: Code generation, debugging, refactoring, and AST manipulation.
  - `reasoning`: Complex multi-step reasoning, mathematical proofs, logic puzzles.
  - `math`: Quantitative problem solving, formulas, calculus.
  - `simple_qa`: Fact retrieval, factual lookups, definitions.
  - `summarization`: Condensing articles, reports, transcripts.
  - `translation`: Multilingual text translation.
  - `creative_writing`: Marketing copy, prose, brainstorms.
  - `data_extraction`: Structured JSON/XML extraction from raw text.
  - `agentic`: Tool-using loops, function calling sequences, autonomous agent steps.
- **Optimal Routing:** Maps the classified task to the highest-performing, lowest-cost provider wire matching that intent (e.g. routing fast lookups to lightweight models and deep reasoning to flagship models).

## System One (Jev) Model Catalog Vetting

Jev serves as the autonomous consistency verification engine for the servable model catalog:
- **Consistency Auditing:** Evaluates new model additions against triangulated 3-source pricing, context window limits, and LM Arena standing.
- **Confidence Gate:** Requires a verification confidence score of >= 0.90 before publishing a model as servable.
- **Advisory & Hold Phases:** Lower-confidence models (< 0.90) are placed on hold (`low_confidence`) to protect downstream customers from invalid pricing or misconfigured context windows.
- **Pricing:** Billed at exact list price with 3-decimal precision ($0.042 per 1M tokens).
