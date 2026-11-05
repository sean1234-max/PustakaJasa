import { describe, it, expect, vi } from 'vitest';

vi.mock('./db.ts', () => ({ db: {} }));
const { costUsdCents } = await import('./usage.ts');

describe('costUsdCents', () => {
  it('prices input, output and cache tokens per model', () => {
    expect(costUsdCents('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 })).toBeCloseTo(600);
    expect(costUsdCents('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 })).toBeCloseTo(300);
    expect(costUsdCents('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(270);
  });

  it('prices an unknown model like the dearest one', () => {
    expect(costUsdCents('claude-x', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(400);
  });
});
