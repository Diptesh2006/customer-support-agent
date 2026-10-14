import { describe, expect, it } from 'vitest';
import { curatedAnswer } from '../src/curated-answers.js';

describe('curated dashboard answers', () => {
  it('answers custom guardrail setup without inventing form details', () => {
    const events = curatedAnswer('how to setup custom guardrails');
    expect(events).toBeDefined();
    const answer = events?.find((event) => event.type === 'token');
    expect(answer?.type).toBe('token');
    if (answer?.type !== 'token') return;
    expect(answer.text).toContain('Guardrails → Keys');
    expect(answer.text).toContain('open **Test**');
    expect(answer.text).toContain('does not specify the Custom creation form');
    expect(answer.text).not.toContain('Create guardrail');
    expect(answer.text).not.toContain('webhook timeout');
  });

  it('does not intercept unrelated or non-procedural questions', () => {
    expect(curatedAnswer('What are custom guardrails?')).toBeUndefined();
    expect(curatedAnswer('How do billing plans work?')).toBeUndefined();
  });
});
