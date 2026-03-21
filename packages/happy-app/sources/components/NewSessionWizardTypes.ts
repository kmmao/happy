import type {
    PermissionModeKey,
    ModelModeKey,
} from "@/components/PermissionModeSelector";
import type { AIBackendProfile } from "@/sync/settings";

export type WizardStep =
    | "profile"
    | "profileConfig"
    | "sessionType"
    | "agent"
    | "options"
    | "machine"
    | "path"
    | "prompt";

export interface ProfileSelectionItemProps {
    profile: AIBackendProfile;
    isSelected: boolean;
    onSelect: () => void;
    onUseAsIs: () => void;
    onEdit: () => void;
    onDuplicate?: () => void;
    onDelete?: () => void;
    showManagementActions?: boolean;
}

export interface ManualConfigurationItemProps {
    isSelected: boolean;
    onSelect: () => void;
    onUseCliVars: () => void;
    onConfigureManually: () => void;
}

export interface NewSessionWizardProps {
    onComplete: (config: {
        sessionType: "simple" | "worktree";
        profileId: string | null;
        agentType: "claude" | "codex";
        permissionMode: PermissionModeKey;
        modelMode: ModelModeKey;
        machineId: string;
        path: string;
        prompt: string;
        environmentVariables?: Record<string, string>;
    }) => void;
    onCancel: () => void;
    initialPrompt?: string;
}
