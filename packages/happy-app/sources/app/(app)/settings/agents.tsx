/**
 * Settings → Agent Defaults screen — ported from upstream b042d834a with
 * two adaptations:
 *
 *   1. Every user-visible string goes through t() against the new
 *      `settingsAgents.*` translation keys. Upstream hard-coded English.
 *   2. The fork's code defaults pin `permissionMode: 'default'`, so the
 *      "Use code default" subtitle below will reflect that — users who want
 *      yolo / bypass have to pick it explicitly here, which is the project's
 *      intended safety posture.
 *
 * UI: per agent, an ItemGroup with three accordion rows (Permission, Model,
 * Effort). Tapping a row expands the option list inline; tapping an option
 * sets the override. The "Use code default" row at the top of each
 * expanded list clears the override.
 */
import * as React from "react";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import {
    getHardcodedModelModes,
    getHardcodedPermissionModes,
    type ModeOption,
} from "@/components/modelModeOptions";
import { getVisibleEffortLevels } from "@/components/reasoningEffort";
import { useSettingMutable } from "@/sync/storage";
import {
    agentKeys,
    getCodeAgentDefaults,
    getAgentDefaultOverrideValue,
    hasAgentDefaultOverride,
    resolveAgentDefaultConfig,
    setAgentDefaultOverride,
    type AgentDefaultField,
    type AgentKey,
} from "@/sync/agentDefaults";
import { t } from "@/text";

type ExpandedField = {
    agent: AgentKey;
    field: AgentDefaultField;
} | null;

type FieldConfig = {
    field: AgentDefaultField;
    title: string;
    icon: keyof typeof Ionicons.glyphMap;
    options: ModeOption[];
    codeDefaultKey: string | null;
};

// Agent display labels — these are product names (Claude Code, Codex,
// Gemini, OpenClaw) so we keep them untranslated per the project's i18n
// rule about technical / brand terms.
const agentLabels: Record<AgentKey, string> = {
    claude: "Claude Code",
    codex: "Codex",
    gemini: "Gemini",
    openclaw: "OpenClaw",
};

function optionName(
    options: ModeOption[],
    key: string | null | undefined,
): string {
    if (!key) return t("settingsAgents.noneLabel");
    return options.find((option) => option.key === key)?.name ?? key;
}

export default React.memo(function AgentDefaultsSettingsScreen() {
    const { theme } = useUnistyles();
    const [agentDefaultOverrides, setAgentDefaultOverrides] =
        useSettingMutable("agentDefaultOverrides");
    const [expanded, setExpanded] = React.useState<ExpandedField>(null);

    const updateOverride = React.useCallback(
        (agent: AgentKey, field: AgentDefaultField, value: string | null) => {
            setAgentDefaultOverrides(
                setAgentDefaultOverride(agentDefaultOverrides, agent, field, value),
            );
        },
        [agentDefaultOverrides, setAgentDefaultOverrides],
    );

    const renderOption = (
        agent: AgentKey,
        field: AgentDefaultField,
        title: string,
        subtitle: string | undefined,
        selected: boolean,
        value: string | null,
    ) => (
        <Item
            key={`${agent}-${field}-${value ?? "default"}`}
            title={title}
            subtitle={subtitle}
            onPress={() => updateOverride(agent, field, value)}
            showChevron={false}
            rightElement={
                selected ? (
                    <Ionicons
                        name="checkmark"
                        size={20}
                        color={theme.colors.header.tint}
                    />
                ) : undefined
            }
        />
    );

    const renderField = (agent: AgentKey, config: FieldConfig) => {
        const effectiveDefaults = resolveAgentDefaultConfig(
            agentDefaultOverrides,
            agent,
        );
        const effectiveValue = effectiveDefaults[config.field];
        const overrideValue = getAgentDefaultOverrideValue(
            agentDefaultOverrides,
            agent,
            config.field,
        );
        const hasOverride = hasAgentDefaultOverride(
            agentDefaultOverrides,
            agent,
            config.field,
        );
        const isExpanded =
            expanded?.agent === agent && expanded.field === config.field;
        const detail = hasOverride
            ? optionName(config.options, overrideValue)
            : t("settingsAgents.defaultDetail", {
                  value: optionName(config.options, effectiveValue),
              });
        const codeDefaultLabel = optionName(
            config.options,
            config.codeDefaultKey,
        );

        return (
            <React.Fragment key={`${agent}-${config.field}`}>
                <Item
                    title={config.title}
                    detail={detail}
                    icon={
                        <Ionicons
                            name={config.icon}
                            size={29}
                            color={theme.colors.accentBlue}
                        />
                    }
                    onPress={() =>
                        setExpanded(
                            isExpanded ? null : { agent, field: config.field },
                        )
                    }
                />
                {isExpanded && (
                    <>
                        {renderOption(
                            agent,
                            config.field,
                            t("settingsAgents.useCodeDefault"),
                            codeDefaultLabel ? codeDefaultLabel : undefined,
                            !hasOverride,
                            null,
                        )}
                        {config.options.map((option) =>
                            renderOption(
                                agent,
                                config.field,
                                option.name,
                                option.description ?? undefined,
                                hasOverride && overrideValue === option.key,
                                option.key,
                            ),
                        )}
                    </>
                )}
            </React.Fragment>
        );
    };

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup title={t("settingsAgents.groupTitle")}>
                <Item
                    title={t("settingsAgents.clearOverrides")}
                    subtitle={t("settingsAgents.clearOverridesSubtitle")}
                    icon={
                        <Ionicons
                            name="refresh-outline"
                            size={29}
                            color={theme.colors.accentOrange}
                        />
                    }
                    onPress={() => setAgentDefaultOverrides({})}
                    disabled={Object.keys(agentDefaultOverrides).length === 0}
                    showChevron={false}
                />
            </ItemGroup>

            {agentKeys.map((agent) => {
                const codeDefaults = getCodeAgentDefaults(agent);
                const effectiveDefaults = resolveAgentDefaultConfig(
                    agentDefaultOverrides,
                    agent,
                );
                const permissionOptions = getHardcodedPermissionModes(agent, t);
                const modelOptions = getHardcodedModelModes(agent, t).filter(
                    (option) => option.key !== "default",
                );
                // Adapt this fork's getVisibleEffortLevels (returns string[])
                // to ModeOption shape so the renderer can treat effort rows the
                // same way as permission/model rows. Upstream had a dedicated
                // EffortLevel object type; here we synthesize one inline.
                const effortKeys = getVisibleEffortLevels({
                    isCodex: agent === "codex",
                    modelModeKey: effectiveDefaults.modelMode,
                });
                const effortOptions: ModeOption[] = effortKeys.map((key) => ({
                    key,
                    name: key.charAt(0).toUpperCase() + key.slice(1),
                }));
                const fields: FieldConfig[] = [
                    {
                        field: "permissionMode",
                        title: t("settingsAgents.fieldPermission"),
                        icon: "shield-checkmark-outline",
                        options: permissionOptions,
                        codeDefaultKey: codeDefaults.permissionMode,
                    },
                    ...(modelOptions.length > 0
                        ? ([
                              {
                                  field: "modelMode" as const,
                                  title: t("settingsAgents.fieldModel"),
                                  icon: "hardware-chip-outline" as const,
                                  options: modelOptions,
                                  codeDefaultKey: codeDefaults.modelMode,
                              },
                          ] as FieldConfig[])
                        : []),
                    ...(effortOptions.length > 0
                        ? ([
                              {
                                  field: "effortLevel" as const,
                                  title: t("settingsAgents.fieldEffort"),
                                  icon: "speedometer-outline" as const,
                                  options: effortOptions,
                                  codeDefaultKey: codeDefaults.effortLevel,
                              },
                          ] as FieldConfig[])
                        : []),
                ];

                return (
                    <ItemGroup key={agent} title={agentLabels[agent]}>
                        {fields.map((field) => renderField(agent, field))}
                    </ItemGroup>
                );
            })}
        </ItemList>
    );
});
