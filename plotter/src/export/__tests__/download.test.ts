import { describe, expect, it } from 'vitest';
import { formatTimestamp, svgFilename } from '../download.ts';

describe('formatTimestamp', () => {
  it('formats as YYYYMMDD-HHmmss with zero-padding', () => {
    const d = new Date(2026, 0, 5, 9, 3, 7); // Jan 5 2026, 09:03:07 local
    expect(formatTimestamp(d)).toBe('20260105-090307');
  });
});

describe('svgFilename', () => {
  it('follows the {generator}_{seed}_{timestamp}.svg convention', () => {
    const d = new Date(2026, 8, 2, 14, 30, 0);
    expect(svgFilename('flowField', 42, d)).toBe('flowField_42_20260902-143000.svg');
  });
});
