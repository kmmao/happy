import { describe, it, expect } from 'vitest';
import { extractMachineError } from './machineUtils';

describe('extractMachineError', () => {
    it('prefers stderr, then error, then a default', () => {
        expect(extractMachineError({ stderr: 'boom', error: 'e' })).toBe('boom');
        expect(extractMachineError({ error: 'only error' })).toBe('only error');
        expect(extractMachineError({})).toBe('Unknown error');
    });

    it('falls through empty stderr to the error field', () => {
        expect(extractMachineError({ stderr: '', error: 'fallback' })).toBe('fallback');
    });

    it('truncates stderr to maxLength when requested', () => {
        const long = 'x'.repeat(250);
        expect(extractMachineError({ stderr: long }, { maxLength: 100 })).toBe('x'.repeat(100));
    });

    it('does not truncate when no maxLength is given', () => {
        const long = 'y'.repeat(250);
        expect(extractMachineError({ stderr: long })).toBe(long);
    });
});
