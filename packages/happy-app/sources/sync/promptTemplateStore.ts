/**
 * Prompt Template Zustand Store
 *
 * Independent store for prompt template management.
 * Templates are persisted in UserKVStore with E2E encryption.
 * Follows the same pattern as kanbanStore.ts.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { sync } from "./sync";
import { kvList, kvMutate, type KvItem } from "./apiKv";
import {
    type PromptTemplate,
    type PromptTemplateData,
    templateKey,
    parseTemplateKey,
    BUILTIN_TEMPLATES,
} from "./promptTemplateTypes";
import { randomUUID } from "expo-crypto";

//
// State
//

interface TemplateState {
    readonly templates: Readonly<Record<string, PromptTemplate>>;
    readonly isLoading: boolean;
    readonly isLoaded: boolean;
}

interface TemplateActions {
    loadTemplates: () => Promise<void>;
    saveTemplate: (template: PromptTemplate) => Promise<PromptTemplate>;
    createTemplate: (
        data: Partial<PromptTemplateData> & Pick<PromptTemplateData, "name" | "content">,
    ) => Promise<PromptTemplate>;
    deleteTemplate: (templateId: string) => Promise<void>;
    handleKvUpdate: (
        changes: ReadonlyArray<{
            readonly key: string;
            readonly value: string | null;
            readonly version: number;
        }>,
    ) => void;
    reset: () => void;
}

type TemplateStore = TemplateState & TemplateActions;

//
// Encryption helpers
//

async function encryptTemplateData(data: PromptTemplateData): Promise<string> {
    const encryption = sync.encryption;
    return await encryption.encryptRaw(data);
}

async function decryptTemplateData(
    encrypted: string,
): Promise<PromptTemplateData | null> {
    const encryption = sync.encryption;
    return await encryption.decryptRaw(encrypted);
}

async function decryptKvItem(item: KvItem): Promise<PromptTemplate | null> {
    const id = parseTemplateKey(item.key);
    if (!id) {
        return null;
    }

    const data = await decryptTemplateData(item.value);
    if (!data) {
        return null;
    }

    return {
        ...data,
        id,
        kvVersion: item.version,
    };
}

//
// Built-in template seeding
//

async function seedBuiltInTemplates(
    existing: Record<string, PromptTemplate>,
): Promise<Record<string, PromptTemplate>> {
    const credentials = sync.getCredentials();
    if (!credentials) {
        return existing;
    }

    const missing = BUILTIN_TEMPLATES.filter((bt) => !existing[bt.id]);
    if (missing.length === 0) {
        return existing;
    }

    const now = Date.now();
    const seeded = { ...existing };

    for (const bt of missing) {
        const data: PromptTemplateData = {
            name: bt.name,
            content: bt.content,
            isBuiltIn: true,
            sortOrder: bt.sortOrder,
            createdAt: now,
            updatedAt: now,
        };

        try {
            const encrypted = await encryptTemplateData(data);
            const key = templateKey(bt.id);
            const result = await kvMutate(credentials, [
                { key, value: encrypted, version: -1 },
            ]);

            if (result.success) {
                seeded[bt.id] = {
                    ...data,
                    id: bt.id,
                    kvVersion: result.results[0].version,
                };
            }
        } catch {
            // Seed failure is non-fatal — will retry on next load
        }
    }

    return seeded;
}

//
// Store
//

const initialState: TemplateState = {
    templates: {},
    isLoading: false,
    isLoaded: false,
};

export const promptTemplateStore = create<TemplateStore>()((set, get) => ({
    ...initialState,

    loadTemplates: async () => {
        if (get().isLoading) {
            return;
        }

        set({ isLoading: true });

        try {
            const credentials = sync.getCredentials();
            if (!credentials) {
                set({ isLoading: false });
                return;
            }

            const response = await kvList(credentials, {
                prefix: "kanban/template/",
                limit: 100,
            });

            const decrypted = await Promise.all(response.items.map(decryptKvItem));

            const loaded: Record<string, PromptTemplate> = {};
            for (const tmpl of decrypted) {
                if (tmpl) {
                    loaded[tmpl.id] = tmpl;
                }
            }

            // Merge: keep any template that has a newer kvVersion from real-time updates
            const merged = { ...loaded };
            const prev = get().templates;
            for (const [id, existing] of Object.entries(prev)) {
                if (existing.kvVersion > (merged[id]?.kvVersion ?? -1)) {
                    merged[id] = existing;
                }
            }

            // Seed built-in templates if missing
            const withBuiltIns = await seedBuiltInTemplates(merged);

            set({ templates: withBuiltIns, isLoading: false, isLoaded: true });
        } catch (error) {
            set({ isLoading: false });
            throw error;
        }
    },

    saveTemplate: async (template: PromptTemplate) => {
        const credentials = sync.getCredentials();
        if (!credentials) {
            throw new Error("Not authenticated");
        }

        const updatedData: PromptTemplateData = {
            name: template.name,
            content: template.content,
            isBuiltIn: template.isBuiltIn,
            sortOrder: template.sortOrder,
            createdAt: template.createdAt,
            updatedAt: Date.now(),
        };

        const encrypted = await encryptTemplateData(updatedData);
        const key = templateKey(template.id);

        const result = await kvMutate(credentials, [
            { key, value: encrypted, version: template.kvVersion },
        ]);

        if (!result.success) {
            await get().loadTemplates();
            throw new Error("Template was updated on another device");
        }

        const newVersion = result.results[0].version;
        const updatedTemplate: PromptTemplate = {
            ...updatedData,
            id: template.id,
            kvVersion: newVersion,
        };

        set((prev) => ({
            templates: { ...prev.templates, [template.id]: updatedTemplate },
        }));

        return updatedTemplate;
    },

    createTemplate: async (data) => {
        const credentials = sync.getCredentials();
        if (!credentials) {
            throw new Error("Not authenticated");
        }

        const templateId = randomUUID();
        const now = Date.now();
        const templateData: PromptTemplateData = {
            name: data.name,
            content: data.content,
            isBuiltIn: false,
            sortOrder: data.sortOrder ?? now,
            createdAt: now,
            updatedAt: now,
        };

        const encrypted = await encryptTemplateData(templateData);
        const key = templateKey(templateId);

        const result = await kvMutate(credentials, [
            { key, value: encrypted, version: -1 },
        ]);

        if (!result.success) {
            throw new Error("Failed to create template");
        }

        const newTemplate: PromptTemplate = {
            ...templateData,
            id: templateId,
            kvVersion: result.results[0].version,
        };

        set((prev) => ({
            templates: { ...prev.templates, [templateId]: newTemplate },
        }));

        return newTemplate;
    },

    deleteTemplate: async (templateId: string) => {
        const template = get().templates[templateId];
        if (!template) {
            return;
        }

        if (template.isBuiltIn) {
            throw new Error("Cannot delete built-in templates");
        }

        const credentials = sync.getCredentials();
        if (!credentials) {
            throw new Error("Not authenticated");
        }

        const key = templateKey(templateId);
        const result = await kvMutate(credentials, [
            { key, value: null, version: template.kvVersion },
        ]);

        if (!result.success) {
            await get().loadTemplates();
            throw new Error("Template was updated on another device");
        }

        set((prev) => {
            const { [templateId]: _, ...rest } = prev.templates;
            return { templates: rest };
        });
    },

    handleKvUpdate: (changes) => {
        let newTemplates = get().templates;
        let changed = false;

        for (const change of changes) {
            const id = parseTemplateKey(change.key);
            if (!id) {
                continue;
            }

            if (change.value === null) {
                if (newTemplates[id]) {
                    const { [id]: _, ...rest } = newTemplates;
                    newTemplates = rest;
                    changed = true;
                }
            } else {
                decryptTemplateData(change.value).then((data) => {
                    if (!data) {
                        return;
                    }
                    const updatedTemplate: PromptTemplate = {
                        ...data,
                        id,
                        kvVersion: change.version,
                    };
                    set((prev) => ({
                        templates: { ...prev.templates, [id]: updatedTemplate },
                    }));
                });
            }
        }

        if (changed) {
            set({ templates: newTemplates });
        }
    },

    reset: () => {
        set(initialState);
    },
}));

//
// Selector hooks
//

export function usePromptTemplates(): ReadonlyArray<PromptTemplate> {
    return promptTemplateStore(
        useShallow((s) =>
            Object.values(s.templates).sort((a, b) => a.sortOrder - b.sortOrder),
        ),
    );
}

export function usePromptTemplate(templateId: string): PromptTemplate | null {
    return promptTemplateStore((s) => s.templates[templateId] ?? null);
}

export function usePromptTemplateLoaded(): boolean {
    return promptTemplateStore((s) => s.isLoaded);
}
