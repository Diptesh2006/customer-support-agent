import { describe, it, expect } from 'vitest';
import { runEvals } from '../evals/run-evals.js';
import {
  SupportAgent,
  AgentEvent,
  classifyLocal,
  formatMcpClientConfig,
  isVectorGrounded,
  createResponseCache,
} from '../src/index.js';

describe('Evals Suite', () => {
  it('runs the evaluation suite and asserts 100% pass rate on core safety, dashboard, mcp, jev, and fallback scenarios', async () => {
    const mockAgent: SupportAgent = {
      chat: async function*(req: any) {
        const q = req.messages?.[0]?.content || '';
        
        if (q.includes('Ignore all previous instructions')) {
          yield { type: 'error', code: 'guardrail_blocked', message: 'Blocked' } as AgentEvent;
          return;
        }

        let confidence: 'high' | 'medium' | 'low' = 'high';
        let response = '';

        if (q.includes('platform fee')) {
          response = 'The platform fee is 5%.';
        } else if (q.includes('Which models are live')) {
          response = 'gpt and claude models are live.';
        } else if (q.includes('OpenAI-compatible')) {
          response = 'Yes, the openai compatible API.';
        } else if (q.includes('API key')) {
          response = 'create a key in the dashboard.';
        } else if (q.includes('credits work')) {
          response = 'credit balance runs out, you get 402.';
        } else if (q.includes('virtual key with a spend ceiling')) {
          response = 'dashboard virtual restrict model ceiling.';
        } else if (q.includes('Debug & Trace Canvas')) {
          response = 'trace canvas pipeline gantt.';
        } else if (q.includes('spend logs')) {
          response = 'spend logs unpriced.';
        } else if (q.includes('Answer Inspector')) {
          response = 'timeline inspector stage.';
        } else if (q.includes('organization workspace')) {
          response = 'keys, logs, debug, mcp, models, billing are accessible.';
        } else if (q.includes('MCP server in the dashboard')) {
          response = 'add mcp dashboard.';
        } else if (q.includes('Free tier and Pro tier')) {
          response = 'free pro allowance.';
        } else if (q.includes('tools/list probe')) {
          response = 'test probe tools list.';
        } else if (q.includes('Claude Desktop or Cursor')) {
          response = 'cursor claude api.nrouter.ai/mcp.';
        } else if (q.includes('protect upstream credentials')) {
          response = 'nRouter reverse proxy sanitizes headers and secures credentials.';
        } else if (q.includes('Jev classification for autonomous task')) {
          response = 'Jev routing in auto mode determines task type and selects model.';
        } else if (q.includes('System One Jev vetting')) {
          response = 'System One Jev vetting requires 0.90 confidence before publishing.';
        } else if (q.includes('ground answers in the vector knowledge base')) {
          response = 'Answers use vector embeddings, cosine similarity, and citations to ground replies.';
        } else if (q.includes('cache repeated questions')) {
          response = 'The response cache replays answers with zero latency and zero cost.';
        } else if (q.includes('primary model exhausts')) {
          response = 'fallback 429 exhaust secondary.';
        } else if (q.includes('mask PII')) {
          response = 'mask pii email phone.';
        } else if (q.includes('weather in Paris')) {
          confidence = 'low';
          response = 'I do not know.';
        } else if (q.includes('secret recipe for Coca-Cola')) {
          confidence = 'low';
          response = 'knowledge gap.';
        }
        
        yield { type: 'confidence', level: confidence, score: 0.9, webSearched: false } as AgentEvent;
        yield { type: 'citations', citations: [{ title: 'Doc', url: 'https://docs.nrouter.ai' }] } as AgentEvent;
        yield { type: 'token', text: response } as AgentEvent;
        yield { type: 'done' } as AgentEvent;
      },
      chatSSE: () => new ReadableStream(),
      feedback: async () => {}
    };

    const results = await runEvals(mockAgent);
    
    expect(results.total).toBe(24);
    expect(results.failed).toBe(0);
    expect(results.passRate).toBe(100);
    expect(results.categories['Dashboard']?.passed).toBe(5);
    expect(results.categories['MCP Server']?.passed).toBe(5);
    expect(results.categories['Jev Classification']?.passed).toBe(2);
    expect(results.categories['Vector KB & Caching']?.passed).toBe(2);
  });

  it('evaluates Jev classification categories locally and deterministically', () => {
    expect(classifyLocal('How do I set a spend ceiling on my virtual key?').category).toBe('virtual_keys');
    expect(classifyLocal('How do I add an MCP server to the dashboard?').category).toBe('mcp');
    expect(classifyLocal('What is the difference between Timeline Gantt and Pipeline Canvas?').category).toBe('dashboard');
    expect(classifyLocal('My request failed with 402 payment required').category).toBe('billing');
    expect(classifyLocal('I need to speak to a human representative').category).toBe('escalation');
    expect(classifyLocal('Book a demo meeting with the team').category).toBe('booking');
    expect(classifyLocal('What is the weather in Tokyo?').category).toBe('off_topic');
  });

  it('evaluates MCP client config generation for Claude Desktop and Cursor', () => {
    const config = formatMcpClientConfig('github-tools', 'sk-nrouter-test-key');
    expect(config.claudeDesktop.mcpServers['github-tools']).toBeDefined();
    expect(config.claudeDesktop.mcpServers['github-tools']!.args[2]).toBe('https://api.nrouter.ai/mcp/github-tools');
    expect(config.cursor.url).toBe('https://api.nrouter.ai/mcp/github-tools');
    expect(config.cursor.headers.Authorization).toBe('Bearer sk-nrouter-test-key');
  });

  it('evaluates isVectorGrounded helper and caching behavior', () => {
    const groundedEvents: AgentEvent[] = [
      { type: 'confidence', level: 'high', score: 0.92, webSearched: false },
      { type: 'citations', citations: [{ title: 'KB', url: 'https://docs' }] },
      { type: 'token', text: 'Answer' },
      { type: 'done' },
    ];
    expect(isVectorGrounded(groundedEvents)).toBe(true);

    const webSearchedEvents: AgentEvent[] = [
      { type: 'confidence', level: 'high', score: 0.92, webSearched: true },
      { type: 'citations', citations: [{ title: 'Web', url: 'https://web' }] },
      { type: 'done' },
    ];
    expect(isVectorGrounded(webSearchedEvents)).toBe(false);

    // Verify cache stores and retrieves vector-grounded events
    const cache = createResponseCache({ ttlMs: 60_000 });
    cache.set('test-key', groundedEvents);
    const retrieved = cache.get('test-key');
    expect(retrieved).toBeDefined();
    expect(isVectorGrounded(retrieved!)).toBe(true);
  });
});
