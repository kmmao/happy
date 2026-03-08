/**
 * Issue-Session Link Zustand Store
 *
 * Independent store for tracking which sessions are processing which issues.
 * Persisted in UserKVStore with E2E encryption (same pattern as kanbanStore).
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { sync } from "./sync";
import { kvList, kvMutate, type KvMutation, type KvItem } from "./apiKv";
import {
  type IssueSessionLink,
  type IssueSessionLinkData,
  type IssueSessionStatus,
  issueSessionKey,
  parseIssueSessionKey,
  buildIssueKey,
} from "./issueSessionTypes";

//
// State
//

interface IssueSessionState {
  readonly links: Readonly<Record<string, IssueSessionLink>>;
  readonly isLoading: boolean;
  readonly isLoaded: boolean;
}

interface IssueSessionActions {
  loadLinks: () => Promise<void>;
  createLink: (
    data: Omit<IssueSessionLinkData, "status" | "createdAt" | "updatedAt">,
  ) => Promise<IssueSessionLink>;
  updateStatus: (
    issueKey: string,
    status: IssueSessionStatus,
    extra?: {
      completionComment?: string;
      errorMessage?: string;
      sessionId?: string;
    },
  ) => Promise<void>;
  findBySessionId: (sessionId: string) => IssueSessionLink | null;
  findByIssueKey: (issueKey: string) => IssueSessionLink | null;
  getProcessingLinks: () => readonly IssueSessionLink[];
  handleKvUpdate: (
    changes: ReadonlyArray<{
      readonly key: string;
      readonly value: string | null;
      readonly version: number;
    }>,
  ) => Promise<void>;
  reset: () => void;
}

type IssueSessionStore = IssueSessionState & IssueSessionActions;

//
// Encryption helpers
//

async function encryptLinkData(data: IssueSessionLinkData): Promise<string> {
  const encryption = sync.encryption;
  return await encryption.encryptRaw(data);
}

async function decryptLinkData(
  encrypted: string,
): Promise<IssueSessionLinkData | null> {
  const encryption = sync.encryption;
  return await encryption.decryptRaw(encrypted);
}

async function decryptKvItem(item: KvItem): Promise<IssueSessionLink | null> {
  const issueKey = parseIssueSessionKey(item.key);
  if (!issueKey) {
    return null;
  }

  const data = await decryptLinkData(item.value);
  if (!data) {
    return null;
  }

  return {
    ...data,
    issueKey,
    kvVersion: item.version,
  };
}

//
// Store
//

const initialState: IssueSessionState = {
  links: {},
  isLoading: false,
  isLoaded: false,
};

export const issueSessionStore = create<IssueSessionStore>()((set, get) => ({
  ...initialState,

  loadLinks: async () => {
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
        prefix: "issueSession/",
        limit: 500,
      });

      const decrypted = await Promise.all(response.items.map(decryptKvItem));

      const loaded: Record<string, IssueSessionLink> = {};
      for (const link of decrypted) {
        if (link) {
          loaded[link.issueKey] = link;
        }
      }

      // Merge: keep real-time updates that arrived AFTER the load started,
      // but only if the link also exists in the loaded data (database is
      // the authority — if a link was deleted from the DB, don't resurrect it
      // from memory).
      set((prev) => {
        const merged = { ...loaded };
        for (const [key, existing] of Object.entries(prev.links)) {
          if (
            key in merged &&
            existing.kvVersion > (merged[key]?.kvVersion ?? -1)
          ) {
            merged[key] = existing;
          }
        }
        return { links: merged, isLoading: false, isLoaded: true };
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  createLink: async (data) => {
    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const now = Date.now();
    const issueKey = buildIssueKey(data.projectKey, data.issueNumber);

    const linkData: IssueSessionLinkData = {
      ...data,
      status: "processing",
      createdAt: now,
      updatedAt: now,
    };

    const encrypted = await encryptLinkData(linkData);
    const key = issueSessionKey(issueKey);

    // Check if there's an existing link — use its version for update, otherwise -1 for new
    const existing = get().links[issueKey];
    const version = existing ? existing.kvVersion : -1;

    const result = await kvMutate(credentials, [
      { key, value: encrypted, version },
    ]);

    if (!result.success) {
      await get().loadLinks();
      throw new Error("Link was updated on another device");
    }

    const newLink: IssueSessionLink = {
      ...linkData,
      issueKey,
      kvVersion: result.results[0].version,
    };

    set((prev) => ({
      links: { ...prev.links, [issueKey]: newLink },
    }));

    return newLink;
  },

  updateStatus: async (issueKey, status, extra) => {
    const link = get().links[issueKey];
    if (!link) {
      return;
    }

    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const updatedData: IssueSessionLinkData = {
      issueNumber: link.issueNumber,
      issueTitle: link.issueTitle,
      projectKey: link.projectKey,
      repoLabel: link.repoLabel,
      sessionId: extra?.sessionId ?? link.sessionId,
      machineId: link.machineId,
      repoPath: link.repoPath,
      status,
      createdAt: link.createdAt,
      updatedAt: Date.now(),
      completionComment: extra?.completionComment ?? link.completionComment,
      errorMessage: extra?.errorMessage ?? link.errorMessage,
    };

    const encrypted = await encryptLinkData(updatedData);
    const key = issueSessionKey(issueKey);

    const result = await kvMutate(credentials, [
      { key, value: encrypted, version: link.kvVersion },
    ]);

    if (!result.success) {
      await get().loadLinks();
      throw new Error("Link was updated on another device");
    }

    const updatedLink: IssueSessionLink = {
      ...updatedData,
      issueKey,
      kvVersion: result.results[0].version,
    };

    set((prev) => ({
      links: { ...prev.links, [issueKey]: updatedLink },
    }));
  },

  findBySessionId: (sessionId) => {
    const links = get().links;
    for (const link of Object.values(links)) {
      if (link.sessionId === sessionId) {
        return link;
      }
    }
    return null;
  },

  findByIssueKey: (issueKey) => {
    return get().links[issueKey] ?? null;
  },

  getProcessingLinks: () => {
    return Object.values(get().links).filter(
      (link) => link.status === "processing",
    );
  },

  handleKvUpdate: async (changes) => {
    const currentLinks = get().links;
    const newLinks: Record<string, IssueSessionLink> = { ...currentLinks };
    let changed = false;

    const decryptTasks: Array<
      Promise<{
        issueKey: string;
        data: IssueSessionLinkData | null;
        version: number;
      } | null>
    > = [];

    for (const change of changes) {
      const issueKey = parseIssueSessionKey(change.key);
      if (!issueKey) {
        continue;
      }

      if (change.value === null) {
        if (issueKey in newLinks) {
          delete newLinks[issueKey];
          changed = true;
        }
      } else {
        decryptTasks.push(
          decryptLinkData(change.value).then((data) => ({
            issueKey,
            data,
            version: change.version,
          })),
        );
      }
    }

    const results = await Promise.all(decryptTasks);
    for (const result of results) {
      if (!result || !result.data) continue;
      newLinks[result.issueKey] = {
        ...result.data,
        issueKey: result.issueKey,
        kvVersion: result.version,
      };
      changed = true;
    }

    if (changed) {
      set({ links: newLinks });
    }
  },

  reset: () => {
    set(initialState);
  },
}));

//
// Selector hooks
//

export function useIssueSessionLinks(): ReadonlyArray<IssueSessionLink> {
  return issueSessionStore(useShallow((s) => Object.values(s.links)));
}

export function useIssueSessionLink(issueKey: string): IssueSessionLink | null {
  return issueSessionStore((s) => s.links[issueKey] ?? null);
}

export function useIssueSessionBySessionId(
  sessionId: string,
): IssueSessionLink | null {
  return issueSessionStore(
    useShallow((s) => {
      for (const link of Object.values(s.links)) {
        if (link.sessionId === sessionId) {
          return link;
        }
      }
      return null;
    }),
  );
}

export function useIssueSessionLoading(): boolean {
  return issueSessionStore((s) => s.isLoading);
}
