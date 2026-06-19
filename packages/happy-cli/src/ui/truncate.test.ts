import { describe, it, expect } from 'vitest';
import { truncateForDisplay } from './truncate';

describe('truncateForDisplay', () => {
  it('returns the value unchanged when within the limit', () => {
    expect(truncateForDisplay('hello', 10)).toEqual({ text: 'hello', truncated: false });
  });

  it('returns the value unchanged at exactly the limit', () => {
    expect(truncateForDisplay('hello', 5)).toEqual({ text: 'hello', truncated: false });
  });

  it('cuts to maxLength and flags truncation when over the limit', () => {
    expect(truncateForDisplay('hello world', 5)).toEqual({ text: 'hello', truncated: true });
  });
});
