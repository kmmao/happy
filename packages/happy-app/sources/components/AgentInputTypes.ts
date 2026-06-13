import type * as React from "react";

import { PermissionMode, ModelMode } from "./PermissionModeSelector";
import { Metadata } from "@/sync/storageTypes";
import type { SessionRpcVisualState } from "@/utils/sessionRpcVisualState";
import type { PasteBlock } from "./pasteBlock";

/** SDK reasoning & budget settings */
export interface ReasoningProps {
    thinkingMode?: string | null;
    effortLevel?: string | null;
    maxBudgetUsd?: number | null;
    /** API-side task budget in tokens — model self-paces tool use within the limit (alpha) */
    taskBudgetTokens?: number | null;
    onThinkingModeChange?: (mode: string) => void;
    onEffortLevelChange?: (level: string | null) => void;
    onMaxBudgetUsdChange?: (budget: number | null) => void;
    onTaskBudgetTokensChange?: (tokens: number | null) => void;
}

/** Image/file attachment handling */
export interface ImageProps {
    onImagePaste?: (blob: Blob) => void;
    onFilePaste?: (file: File) => void;
    onImagePickPress?: () => void;
    onTakePhotoPress?: () => void;
    onFilePickPress?: () => void;
    isPickingImage?: boolean;
    imagePaths?: string[];
    /** Displayable URIs parallel to imagePaths — used to render thumbnails */
    imageUris?: string[];
    /** Map from remote path to original filename (for non-image file display). */
    fileNameMap?: ReadonlyMap<string, string>;
    onImageRemove?: (path: string) => void;
}

/** Slash command list state */
export interface CommandProps {
    onSlashCommandPress?: () => void;
    showCommandList?: boolean;
    onCommandSelect?: (text: string) => void;
    onCommandListClose?: () => void;
}

export interface AgentInputProps {
    value: string;
    placeholder: string;
    onChangeText: (text: string) => void;
    sessionId?: string;
    /**
     * Mutable ref slot the host fills with a callback that opens the
     * embedded `@` file picker. Lets a chat-column overlay (e.g. the
     * multi-file preview's "+" button) reopen the picker without the user
     * having to tap the input's own file-browser button. Optional — when
     * omitted, AgentInput simply doesn't expose the control.
     */
    openFilePickerRef?: React.MutableRefObject<(() => void) | null>;
    onSend: () => void;
    sendIcon?: React.ReactNode;
    onMicPress?: () => void;
    isMicActive?: boolean;
    permissionMode?: PermissionMode | null;
    availableModes?: PermissionMode[];
    onPermissionModeChange?: (mode: PermissionMode) => void;
    modelMode?: ModelMode | null;
    effectiveModelLabel?: string | null;
    availableModels?: ModelMode[];
    onModelModeChange?: (mode: ModelMode) => void;
    reasoning?: ReasoningProps;
    metadata?: Metadata | null;
    onAbort?: () => void | Promise<void>;
    showAbortButton?: boolean;
    connectionStatus?: {
        text: string;
        color: string;
        dotColor: string;
        isPulsing?: boolean;
        cliStatus?: {
            claude: boolean | null;
            codex: boolean | null;
            gemini?: boolean | null;
        };
    };
    modelSummaryRpcState?: SessionRpcVisualState | null;
    autocompletePrefixes: string[];
    autocompleteSuggestions: (
        query: string,
    ) => Promise<{ key: string; text: string; component: React.ElementType }[]>;
    usageData?: {
        inputTokens: number;
        outputTokens: number;
        cacheCreation: number;
        cacheRead: number;
        contextSize: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        totalCostUsd?: number;
        contextWindow?: number;
    };
    alwaysShowContextSize?: boolean;
    sdkContextUsage?: {
        totalTokens: number;
        maxTokens: number;
        percentage: number;
        model?: string;
        categories?: Array<{ name: string; tokens: number; color?: string }>;
        isAutoCompactEnabled?: boolean;
        autoCompactThreshold?: number;
        messageBreakdown?: {
            toolCallTokens: number;
            toolResultTokens: number;
            attachmentTokens: number;
            assistantMessageTokens: number;
            userMessageTokens: number;
        };
    } | null;
    currentModelCode?: string | null;
    onFileViewerPress?: () => void;
    agentType?: "claude" | "codex" | "gemini";
    onAgentClick?: () => void;
    machineName?: string | null;
    onMachineClick?: () => void;
    currentPath?: string | null;
    onPathClick?: () => void;
    isInputDisabled?: boolean;
    disabledPlaceholder?: string | null;
    isSendDisabled?: boolean;
    isSending?: boolean;
    minHeight?: number;
    profileId?: string | null;
    onProfileClick?: () => void;
    commands?: CommandProps;
    images?: ImageProps;
    onShellCommand?: (command: string) => void;
    pasteBlocks?: PasteBlock[];
    onLargeTextPaste?: (text: string) => void;
    onPasteBlockRemove?: (id: string) => void;
    onPasteBlockSave?: (id: string, text: string) => void;
    packageScripts?: Record<string, string>;
    promptSuggestion?: string | null;
    onPromptSuggestionPress?: (text: string) => void;
    needsContinue?: boolean;
    onContinuePress?: () => void;
    requiresAction?: boolean;
    onRequiresActionPress?: () => void;
    totalDurationMs?: number;
    completedTurnsDurationMs?: number;
    isThinking?: boolean;
    turnStartedAt?: number;
    /** Max height (px) for popover overlays. Caller passes the available vertical space above the input. */
    overlayMaxHeight?: number;
    contentMaxWidth?: number;
}
