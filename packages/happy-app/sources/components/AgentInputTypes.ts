import { PermissionMode, ModelMode } from "./PermissionModeSelector";
import { Metadata } from "@/sync/storageTypes";

/** SDK reasoning & budget settings */
export interface ReasoningProps {
    thinkingMode?: string | null;
    effortLevel?: string | null;
    maxBudgetUsd?: number | null;
    /** API-side task budget in tokens — model self-paces tool use within the limit (alpha) */
    taskBudgetTokens?: number | null;
    onThinkingModeChange?: (mode: string) => void;
    onEffortLevelChange?: (level: string) => void;
    onMaxBudgetUsdChange?: (budget: number | null) => void;
    onTaskBudgetTokensChange?: (tokens: number | null) => void;
}

/** Speech-to-text state */
export interface SttProps {
    onSttPress?: () => void;
    isSttListening?: boolean;
    isSttCorrecting?: boolean;
}

/** Image attachment handling */
export interface ImageProps {
    onImagePaste?: (blob: Blob) => void;
    onImagePickPress?: () => void;
    isPickingImage?: boolean;
    imagePaths?: string[];
    /** Displayable URIs parallel to imagePaths — used to render thumbnails */
    imageUris?: string[];
    onImageRemove?: (path: string) => void;
}

/** Slash command list state */
export interface CommandProps {
    onSlashCommandPress?: () => void;
    showCommandList?: boolean;
    onCommandSelect?: (command: string) => void;
    onCommandListClose?: () => void;
}

export interface AgentInputProps {
    value: string;
    placeholder: string;
    onChangeText: (text: string) => void;
    sessionId?: string;
    onSend: () => void;
    sendIcon?: React.ReactNode;
    onMicPress?: () => void;
    isMicActive?: boolean;
    stt?: SttProps;
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
    currentModelCode?: string | null;
    onFileViewerPress?: () => void;
    agentType?: "claude" | "codex" | "gemini";
    onAgentClick?: () => void;
    machineName?: string | null;
    onMachineClick?: () => void;
    currentPath?: string | null;
    onPathClick?: () => void;
    isSendDisabled?: boolean;
    isSending?: boolean;
    minHeight?: number;
    profileId?: string | null;
    onProfileClick?: () => void;
    commands?: CommandProps;
    images?: ImageProps;
    onShellCommand?: (command: string) => void;
    packageScripts?: Record<string, string>;
    promptSuggestion?: string | null;
    onPromptSuggestionPress?: (text: string) => void;
    needsContinue?: boolean;
    onContinuePress?: () => void;
    totalDurationMs?: number;
    completedTurnsDurationMs?: number;
    isThinking?: boolean;
    turnStartedAt?: number;
}
