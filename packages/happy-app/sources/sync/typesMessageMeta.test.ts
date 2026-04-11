import { describe, expect, it } from 'vitest';
import { MessageMetaSchema } from './typesMessageMeta';

describe('MessageMetaSchema', () => {
    it('accepts arbitrary permission mode keys', () => {
        const parsed = MessageMetaSchema.parse({
            permissionMode: 'team-custom-mode',
            model: 'custom-model',
        });

        expect(parsed.permissionMode).toBe('team-custom-mode');
        expect(parsed.model).toBe('custom-model');
    });

    it('accepts auto option send source marker', () => {
        const parsed = MessageMetaSchema.parse({
            source: 'auto-option-send',
        });

        expect(parsed.source).toBe('auto-option-send');
    });
});
