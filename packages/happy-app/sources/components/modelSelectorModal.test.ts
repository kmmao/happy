import { describe, expect, it } from 'vitest';
import { shouldUseModelSelectorModal } from './modelSelectorModal';

describe('shouldUseModelSelectorModal', () => {
    it('returns true on narrow native mobile widths', () => {
        expect(shouldUseModelSelectorModal({ platformOs: 'ios', screenWidth: 390 })).toBe(true);
        expect(shouldUseModelSelectorModal({ platformOs: 'android', screenWidth: 430 })).toBe(true);
    });

    it('returns true on narrow web widths', () => {
        expect(shouldUseModelSelectorModal({ platformOs: 'web', screenWidth: 390 })).toBe(true);
    });

    it('returns false on tablet and desktop-sized layouts', () => {
        expect(shouldUseModelSelectorModal({ platformOs: 'ios', screenWidth: 900 })).toBe(false);
        expect(shouldUseModelSelectorModal({ platformOs: 'web', screenWidth: 1024 })).toBe(false);
    });
});
