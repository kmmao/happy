import { describe, expect, it } from 'vitest';
import {
    dimensionTemplates,
    defaultEnabledDimensions,
    buildDimensionsSection,
    getEnabledCategories,
} from './dimensionTemplates';

describe('dimensionTemplates', () => {
    it('should have all 13 dimensions defined', () => {
        const keys = Object.keys(dimensionTemplates);
        expect(keys).toHaveLength(13);
        expect(keys).toContain('security');
        expect(keys).toContain('dependencies');
        expect(keys).toContain('architecture');
        expect(keys).toContain('techDebt');
        expect(keys).toContain('codeQuality');
        expect(keys).toContain('testCoverage');
        expect(keys).toContain('documentation');
        expect(keys).toContain('performance');
        expect(keys).toContain('uiUx');
        expect(keys).toContain('typeSafety');
        expect(keys).toContain('observability');
        expect(keys).toContain('apiDesign');
        expect(keys).toContain('buildCI');
    });

    it('should have key, title, category, and prompt for each dimension', () => {
        for (const [key, template] of Object.entries(dimensionTemplates)) {
            expect(template.key).toBe(key);
            expect(template.title).toBeTruthy();
            expect(template.category).toBeTruthy();
            expect(template.prompt).toBeTruthy();
        }
    });
});

describe('defaultEnabledDimensions', () => {
    it('should include security, dependencies, and architecture', () => {
        expect(defaultEnabledDimensions).toContain('security');
        expect(defaultEnabledDimensions).toContain('dependencies');
        expect(defaultEnabledDimensions).toContain('architecture');
    });

    it('should have exactly 3 defaults', () => {
        expect(defaultEnabledDimensions).toHaveLength(3);
    });
});

describe('buildDimensionsSection', () => {
    it('should build numbered sections for enabled dimensions', () => {
        const result = buildDimensionsSection(['security', 'dependencies']);
        expect(result).toContain('### 1. Security');
        expect(result).toContain('### 2. Dependencies');
    });

    it('should skip unknown dimension keys', () => {
        const result = buildDimensionsSection(['security', 'nonexistent', 'performance']);
        expect(result).toContain('### 1. Security');
        expect(result).toContain('### 2. Performance');
        expect(result).not.toContain('nonexistent');
    });

    it('should return empty string for empty input', () => {
        const result = buildDimensionsSection([]);
        expect(result).toBe('');
    });

    it('should include prompt instructions in output', () => {
        const result = buildDimensionsSection(['security']);
        expect(result).toContain('yarn audit');
    });
});

describe('getEnabledCategories', () => {
    it('should return categories for enabled dimensions', () => {
        const categories = getEnabledCategories(['security', 'techDebt']);
        expect(categories).toEqual(['security', 'tech-debt']);
    });

    it('should filter out unknown keys', () => {
        const categories = getEnabledCategories(['security', 'bogus']);
        expect(categories).toEqual(['security']);
    });

    it('should return empty array for empty input', () => {
        const categories = getEnabledCategories([]);
        expect(categories).toEqual([]);
    });

    it('should return all 13 categories when all dimensions enabled', () => {
        const allKeys = Object.keys(dimensionTemplates);
        const categories = getEnabledCategories(allKeys);
        expect(categories).toHaveLength(13);
    });
});
