import { describe, it, expect } from 'vitest';
import { isSmallTalk } from '../src/small-talk.js';

describe('isSmallTalk', () => {
  it('is true for greetings, thanks and sign-offs', () => {
    for (const msg of [
      'hi', 'Hi!', 'hello', 'Hey there', 'hello team', 'good morning', 'Good evening!',
      'thanks', 'Thank you so much', 'thx', 'ok thanks', 'ok', 'great, thank you', 'bye',
      'how are you?', '  HI  ', 'hi 👋', '👋', '', 'thank you thank you',
      'hello support', 'good night', 'thanks a lot', 'see you later', 'hi all',
    ]) {
      expect(isSmallTalk(msg), JSON.stringify(msg)).toBe(true);
    }
  });

  it('is false as soon as the message asks for anything', () => {
    for (const msg of [
      'hi, how do I create a key?', 'hello pricing', 'thanks, and what about refunds?',
      'how are you billing me', 'good morning, is the API down', 'ok so what is the rate limit',
      'pricing', 'help', '402', 'hi hi hi hi hi hi hi hi hi',
      // Filler words are small talk only beside a greeting: alone they can be a real follow-up.
      'team?', 'all?', 'so much?', 'support', 'a lot', 'how much',
    ]) {
      expect(isSmallTalk(msg), JSON.stringify(msg)).toBe(false);
    }
  });

  it('is false for anything that is not a string', () => {
    for (const msg of [undefined, null, 42, {}, ['hi']]) {
      expect(isSmallTalk(msg as unknown as string)).toBe(false);
    }
  });

  it('scans a bounded prefix, so a long message is never small talk', () => {
    expect(isSmallTalk('hi '.repeat(5000))).toBe(false);
  });
});
