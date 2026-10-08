import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupportAgent } from '../src/index.js';

export interface EvalCase {
  id: string;
  category?: string;
  question: string;
  expect: {
    confidenceIn?: string[];
    containsAny?: string[];
    notContains?: string[];
    okErrors?: string[];
  };
}

export interface EvalDataset {
  description: string;
  cases: EvalCase[];
}

export interface EvalResult {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  categories: Record<string, { total: number; passed: number }>;
}

export async function runEvals(agent: SupportAgent): Promise<EvalResult> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const datasetPath = path.join(dir, 'dataset.json');
  const dataset: EvalDataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const result: EvalResult = {
    total: dataset.cases.length,
    passed: 0,
    failed: 0,
    passRate: 0,
    categories: {}
  };

  for (const tc of dataset.cases) {
    const category = tc.category || 'Uncategorized';
    if (!result.categories[category]) {
      result.categories[category] = { total: 0, passed: 0 };
    }
    result.categories[category].total++;

    let responseText = '';
    let confidenceLevel: string | null = null;
    let okError = false;
    let errorSeen = false;

    try {
      const stream = agent.chat({
        messages: [{ role: 'user', content: tc.question }]
      });

      for await (const event of stream) {
        if (event.type === 'token') {
          responseText += event.text;
        } else if (event.type === 'confidence') {
          confidenceLevel = event.level;
        } else if (event.type === 'error') {
          errorSeen = true;
          if (tc.expect.okErrors && tc.expect.okErrors.includes(event.code)) {
            okError = true;
          }
        }
      }

      let pass = true;

      if (errorSeen && !okError) {
        pass = false;
      } else if (okError) {
        pass = true;
      } else {
        if (tc.expect.confidenceIn && (!confidenceLevel || !tc.expect.confidenceIn.includes(confidenceLevel))) {
          pass = false;
        }
        if (tc.expect.containsAny) {
          const hasAny = tc.expect.containsAny.some(word => responseText.toLowerCase().includes(word.toLowerCase()));
          if (!hasAny) {
            pass = false;
          }
        }
        if (tc.expect.notContains) {
          const hasBanned = tc.expect.notContains.some(word => responseText.toLowerCase().includes(word.toLowerCase()));
          if (hasBanned) {
            pass = false;
          }
        }
      }

      if (pass) {
        result.passed++;
        result.categories[category].passed++;
      } else {
        result.failed++;
      }

    } catch (e) {
      result.failed++;
    }
  }

  result.passRate = result.total === 0 ? 0 : (result.passed / result.total) * 100;
  return result;
}

// Allow running as a script directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Use run.mjs to execute against the live API, or import runEvals in tests.');
}
