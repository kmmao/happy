import * as React from "react";
import {
    machineListAgentLoops,
    machineListAgentLoopBootstrapProfiles,
    machineListAutoDreamProfiles,
    machinePauseAgentLoopBootstrapProfile,
    machineResumeAgentLoopBootstrapProfile,
    machineRunNowAgentLoopBootstrapProfile,
    machineRemoveAgentLoopBootstrapProfile,
    machinePauseAutoDreamProfile,
    machineResumeAutoDreamProfile,
    machineRunNowAutoDreamProfile,
    machineRemoveAutoDreamProfile,
    type MachineAgentLoop,
    type MachineAgentLoopBootstrapProfile,
    type MachineAutoDreamProfile,
} from "@/sync/ops";
import { Modal } from "@/modal";
import { t } from "@/text";
import { ensureMachineAutomationProfiles } from "./machineAutomationQuickSetup";
import { type OneClickAutomationProfilesRef } from "./useOneClickSetup";
import {
    commonDirectoryPrefix,
    isRpcMethodUnavailableError,
} from "./loopsUtils";

interface UseLoopsDataParams {
    machineId: string | undefined;
    rpcReady: boolean;
}

interface UseLoopsDataResult {
    // Data
    readonly loops: readonly MachineAgentLoop[];
    readonly loading: boolean;
    readonly refreshing: boolean;
    readonly bootstrapProfiles: readonly MachineAgentLoopBootstrapProfile[];
    readonly autoDreamProfiles: readonly MachineAutoDreamProfile[];
    readonly upstreamLoopIdsByLoopId: Record<string, string[]>;
    readonly automationProfilesRef: React.MutableRefObject<OneClickAutomationProfilesRef>;

    // Profile editing state
    readonly mutatingBootstrapProfileId: string | null;
    readonly editingBootstrapProfile: MachineAgentLoopBootstrapProfile | null;
    readonly setEditingBootstrapProfile: (p: MachineAgentLoopBootstrapProfile | null) => void;
    readonly bootstrapProfileEditorVisible: boolean;
    readonly setBootstrapProfileEditorVisible: (v: boolean) => void;
    readonly mutatingAutoDreamProfileId: string | null;
    readonly editingAutoDreamProfile: MachineAutoDreamProfile | null;
    readonly setEditingAutoDreamProfile: (p: MachineAutoDreamProfile | null) => void;
    readonly autoDreamProfileEditorVisible: boolean;
    readonly setAutoDreamProfileEditorVisible: (v: boolean) => void;
    readonly automationQuickBusy: boolean;

    // OneClick params
    readonly profileId: string;
    readonly projectId: string;

    // Actions
    readonly load: (kind: "initial" | "refresh") => Promise<void>;
    readonly loadRef: React.MutableRefObject<() => void>;
    readonly runAutomationQuickSetup: () => Promise<void>;
    readonly mutateBootstrapProfile: (profile: MachineAgentLoopBootstrapProfile, action: "pause" | "resume" | "run-now" | "remove") => Promise<void>;
    readonly mutateAutoDreamProfile: (profile: MachineAutoDreamProfile, action: "pause" | "resume" | "run-now" | "remove") => Promise<void>;
}

export function useLoopsData({ machineId, rpcReady }: UseLoopsDataParams): UseLoopsDataResult {
    const loadRef = React.useRef<() => void>(() => {});
    const [loops, setLoops] = React.useState<MachineAgentLoop[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [bootstrapProfiles, setBootstrapProfiles] = React.useState<MachineAgentLoopBootstrapProfile[]>([]);
    const [autoDreamProfiles, setAutoDreamProfiles] = React.useState<MachineAutoDreamProfile[]>([]);
    const automationProfilesRef = React.useRef<OneClickAutomationProfilesRef>({ bootstrap: [], autoDream: [] });
    const [mutatingBootstrapProfileId, setMutatingBootstrapProfileId] = React.useState<string | null>(null);
    const [editingBootstrapProfile, setEditingBootstrapProfile] = React.useState<MachineAgentLoopBootstrapProfile | null>(null);
    const [bootstrapProfileEditorVisible, setBootstrapProfileEditorVisible] = React.useState(false);
    const [mutatingAutoDreamProfileId, setMutatingAutoDreamProfileId] = React.useState<string | null>(null);
    const [editingAutoDreamProfile, setEditingAutoDreamProfile] = React.useState<MachineAutoDreamProfile | null>(null);
    const [autoDreamProfileEditorVisible, setAutoDreamProfileEditorVisible] = React.useState(false);
    const [automationQuickBusy, setAutomationQuickBusy] = React.useState(false);
    const [profileId, setProfileId] = React.useState("");
    const [projectId, setProjectId] = React.useState("");

    React.useEffect(() => {
        automationProfilesRef.current = { bootstrap: bootstrapProfiles, autoDream: autoDreamProfiles };
    }, [bootstrapProfiles, autoDreamProfiles]);

    const upstreamLoopIdsByLoopId = React.useMemo(() => {
        const mapping: Record<string, string[]> = {};
        loops.forEach((candidate) => {
            candidate.downstreamLoopIds?.forEach((downstreamLoopId) => {
                mapping[downstreamLoopId] = [...(mapping[downstreamLoopId] ?? []), candidate.id];
            });
        });
        return mapping;
    }, [loops]);

    const load = React.useCallback(async (kind: "initial" | "refresh") => {
        if (!machineId || !rpcReady) {
            return;
        }
        if (kind === "initial") {
            setLoading(true);
        } else {
            setRefreshing(true);
        }
        try {
            const results = await Promise.allSettled([
                machineListAgentLoops(machineId),
                machineListAgentLoopBootstrapProfiles(machineId),
                machineListAutoDreamProfiles(machineId),
            ]);
            if (results[0].status === "fulfilled") {
                setLoops(results[0].value.loops ?? []);
            }
            if (results[1].status === "fulfilled") {
                setBootstrapProfiles(results[1].value.profiles ?? []);
            }
            if (results[2].status === "fulfilled") {
                setAutoDreamProfiles(results[2].value.profiles ?? []);
            }
        } catch (error) {
            if (!isRpcMethodUnavailableError(error)) {
                Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
            }
        } finally {
            setLoading(false);
            if (kind === "refresh") {
                setRefreshing(false);
            }
        }
    }, [machineId, rpcReady]);

    loadRef.current = () => void load("refresh");

    const runAutomationQuickSetup = React.useCallback(async () => {
        if (!machineId) {
            return;
        }
        if (loops.length === 0) {
            Modal.alert(t("common.error"), t("machine.automationQuickSetupNoLoops"));
            return;
        }
        const root = commonDirectoryPrefix(loops.map((loopItem) => loopItem.directory));
        if (!root || root === "/") {
            Modal.alert(t("common.error"), t("machine.automationQuickSetupNoRoot"));
            return;
        }
        setAutomationQuickBusy(true);
        try {
            const r = await ensureMachineAutomationProfiles(machineId, root, bootstrapProfiles, autoDreamProfiles);
            if (r.errorMessages.length > 0) {
                Modal.alert(t("common.error"), r.errorMessages.join("\n"));
            }
            if (r.outcome === "created") {
                Modal.toast(t("machine.automationQuickSetupDone"));
            } else if (r.outcome === "already") {
                Modal.toast(t("machine.automationQuickSetupNothingTodo"));
            } else {
                Modal.alert(t("common.error"), t("machine.automationQuickSetupNoRoot"));
            }
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setAutomationQuickBusy(false);
        }
    }, [autoDreamProfiles, bootstrapProfiles, load, loops, machineId]);

    const mutateBootstrapProfile = React.useCallback(async (profile: MachineAgentLoopBootstrapProfile, action: "pause" | "resume" | "run-now" | "remove") => {
        if (!machineId) {
            return;
        }
        setMutatingBootstrapProfileId(profile.id);
        try {
            const result = action === "pause"
                ? await machinePauseAgentLoopBootstrapProfile(machineId, profile.id)
                : action === "resume"
                    ? await machineResumeAgentLoopBootstrapProfile(machineId, profile.id)
                    : action === "run-now"
                        ? await machineRunNowAgentLoopBootstrapProfile(machineId, profile.id)
                        : await machineRemoveAgentLoopBootstrapProfile(machineId, profile.id);
            if (!result.success) {
                throw new Error(result.errorMessage || t("common.error"));
            }
            if (editingBootstrapProfile?.id === profile.id && action === "remove") {
                setBootstrapProfileEditorVisible(false);
            }
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setMutatingBootstrapProfileId(null);
        }
    }, [editingBootstrapProfile?.id, load, machineId]);

    const mutateAutoDreamProfile = React.useCallback(async (profile: MachineAutoDreamProfile, action: "pause" | "resume" | "run-now" | "remove") => {
        if (!machineId) {
            return;
        }
        setMutatingAutoDreamProfileId(profile.id);
        try {
            const result = action === "pause"
                ? await machinePauseAutoDreamProfile(machineId, profile.id)
                : action === "resume"
                    ? await machineResumeAutoDreamProfile(machineId, profile.id)
                    : action === "run-now"
                        ? await machineRunNowAutoDreamProfile(machineId, profile.id)
                        : await machineRemoveAutoDreamProfile(machineId, profile.id);
            if (!result.success) {
                throw new Error(result.errorMessage || t("common.error"));
            }
            if (editingAutoDreamProfile?.id === profile.id && action === "remove") {
                setAutoDreamProfileEditorVisible(false);
            }
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setMutatingAutoDreamProfileId(null);
        }
    }, [editingAutoDreamProfile?.id, load, machineId]);

    return {
        loops,
        loading,
        refreshing,
        bootstrapProfiles,
        autoDreamProfiles,
        upstreamLoopIdsByLoopId,
        automationProfilesRef,
        mutatingBootstrapProfileId,
        editingBootstrapProfile,
        setEditingBootstrapProfile,
        bootstrapProfileEditorVisible,
        setBootstrapProfileEditorVisible,
        mutatingAutoDreamProfileId,
        editingAutoDreamProfile,
        setEditingAutoDreamProfile,
        autoDreamProfileEditorVisible,
        setAutoDreamProfileEditorVisible,
        automationQuickBusy,
        profileId,
        projectId,
        load,
        loadRef,
        runAutomationQuickSetup,
        mutateBootstrapProfile,
        mutateAutoDreamProfile,
    };
}
