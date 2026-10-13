import fs from 'node:fs';
import { createSupportAgent } from '../dist/index.js';
import { readDocsDir } from '../dist/node.js';

const apiKey = process.env.NROUTER_API_KEY;
const kbPath = process.env.KB_PATH;
if (!apiKey || !kbPath) {
  console.error('Set NROUTER_API_KEY and KB_PATH. This comparison makes live, billed model calls.');
  process.exit(1);
}

const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
const dataset = JSON.parse(fs.readFileSync(new URL('dataset.json', import.meta.url), 'utf8'));
const docs = await readDocsDir(process.env.DOCS_DIR || 'examples/quickstart/docs', process.env.DOCS_BASE_URL || undefined);
const percentile = (values, p) => values.length ? values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : 0;

for (const strategy of ['rag', 'cag']) {
  const turnMetrics = [];
  const agent = createSupportAgent({
    apiKey,
    model: process.env.EVAL_MODEL || 'claude-haiku-4-5-20251001',
    knowledge: kb,
    knowledgeStrategy: strategy,
    ...(strategy === 'cag' ? { knowledgeCorpus: docs } : {}),
    responseCache: false,
    hooks: { onTurnMetrics: metric => turnMetrics.push(metric) },
  });
  let passed = 0;
  let exactCostUsd = 0;
  let pricedTurns = 0;
  const latencies = [];

  for (const testCase of dataset.cases) {
    let answer = '';
    let confidence = null;
    let cost = null;
    for await (const event of agent.chat({ messages: [{ role: 'user', content: testCase.question }] })) {
      if (event.type === 'token') answer += event.text;
      if (event.type === 'confidence') confidence = event.level;
      if (event.type === 'cost') cost = event;
    }
    const expected = testCase.expect;
    const ok = (!expected.confidenceIn || expected.confidenceIn.includes(confidence))
      && (!expected.containsAny || expected.containsAny.some(word => answer.toLowerCase().includes(word.toLowerCase())))
      && (!expected.notContains || !expected.notContains.some(word => answer.toLowerCase().includes(word.toLowerCase())));
    if (ok) passed++;
    if (cost?.status === 'exact' && typeof cost.costUsd === 'number') {
      exactCostUsd += cost.costUsd;
      pricedTurns++;
    }
    const metric = turnMetrics.at(-1);
    if (metric) latencies.push(metric.totalMs);
    console.log(`${strategy} ${testCase.id}: ${ok ? 'PASS' : 'FAIL'}${metric ? ` ${metric.totalMs}ms` : ''}`);
  }

  console.log(JSON.stringify({
    strategy,
    passed,
    total: dataset.cases.length,
    passRate: dataset.cases.length ? passed / dataset.cases.length : 0,
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    contextChars: turnMetrics.at(-1)?.contextChars ?? 0,
    exactCostUsd,
    pricedTurns,
    note: 'Cold uncached turns; cost excludes any unpriced calls. RAG confidence is retrieval similarity; CAG confidence is not directly comparable.',
  }));
}
