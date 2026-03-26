import React from 'react';
import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { EnvironmentVariableCard } from './EnvironmentVariableCard';
import type { ProfileDocumentation } from '@/sync/profileUtils';

/**
 * Common environment variable suggestions for AI coding tools.
 * Grouped by category for easy browsing.
 */
const ENV_VAR_SUGGESTIONS: ReadonlyArray<{ name: string; category: string }> = [
    // Anthropic / Claude
    { name: 'ANTHROPIC_AUTH_TOKEN', category: 'Anthropic' },
    { name: 'ANTHROPIC_BASE_URL', category: 'Anthropic' },
    { name: 'ANTHROPIC_MODEL', category: 'Anthropic' },
    { name: 'ANTHROPIC_SMALL_FAST_MODEL', category: 'Anthropic' },
    { name: 'ANTHROPIC_DEFAULT_OPUS_MODEL', category: 'Anthropic' },
    { name: 'ANTHROPIC_DEFAULT_SONNET_MODEL', category: 'Anthropic' },
    { name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', category: 'Anthropic' },
    // OpenAI / Codex
    { name: 'OPENAI_API_KEY', category: 'OpenAI' },
    { name: 'OPENAI_BASE_URL', category: 'OpenAI' },
    { name: 'OPENAI_MODEL', category: 'OpenAI' },
    { name: 'OPENAI_SMALL_FAST_MODEL', category: 'OpenAI' },
    // Azure OpenAI
    { name: 'AZURE_OPENAI_ENDPOINT', category: 'Azure' },
    { name: 'AZURE_OPENAI_API_KEY', category: 'Azure' },
    { name: 'AZURE_OPENAI_API_VERSION', category: 'Azure' },
    { name: 'AZURE_OPENAI_DEPLOYMENT_NAME', category: 'Azure' },
    // Common / General
    { name: 'API_TIMEOUT_MS', category: 'General' },
    { name: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', category: 'General' },
    { name: 'HTTP_PROXY', category: 'General' },
    { name: 'HTTPS_PROXY', category: 'General' },
    { name: 'NO_PROXY', category: 'General' },
    { name: 'NODE_EXTRA_CA_CERTS', category: 'General' },
    // Custom provider prefixes
    { name: 'DEEPSEEK_AUTH_TOKEN', category: 'DeepSeek' },
    { name: 'DEEPSEEK_BASE_URL', category: 'DeepSeek' },
    { name: 'DEEPSEEK_MODEL', category: 'DeepSeek' },
    { name: 'Z_AI_AUTH_TOKEN', category: 'Z.AI' },
    { name: 'Z_AI_BASE_URL', category: 'Z.AI' },
    { name: 'Z_AI_MODEL', category: 'Z.AI' },
    { name: 'MINIMAX_AUTH_TOKEN', category: 'MiniMax' },
    { name: 'MINIMAX_BASE_URL', category: 'MiniMax' },
    { name: 'MINIMAX_MODEL', category: 'MiniMax' },
];

export interface EnvironmentVariablesListProps {
    environmentVariables: Array<{ name: string; value: string }>;
    machineId: string | null;
    profileDocs?: ProfileDocumentation | null;
    onChange: (newVariables: Array<{ name: string; value: string }>) => void;
}

/**
 * Complete environment variables section with title, add button, and editable cards
 * Matches profile list pattern from index.tsx:1159-1308
 */
export function EnvironmentVariablesList({
    environmentVariables,
    machineId,
    profileDocs,
    onChange,
}: EnvironmentVariablesListProps) {
    const { theme } = useUnistyles();

    // Add variable inline form state
    const [showAddForm, setShowAddForm] = React.useState(false);
    const [newVarName, setNewVarName] = React.useState('');
    const [newVarValue, setNewVarValue] = React.useState('');
    const [showSuggestions, setShowSuggestions] = React.useState(false);

    // Filter suggestions based on current input and already-added variables
    const filteredSuggestions = React.useMemo(() => {
        const existingNames = new Set(environmentVariables.map(v => v.name));
        const query = newVarName.trim().toUpperCase();
        return ENV_VAR_SUGGESTIONS.filter(s =>
            !existingNames.has(s.name) &&
            (query === '' || s.name.includes(query) || s.category.toUpperCase().includes(query))
        );
    }, [newVarName, environmentVariables]);

    // Helper to get expected value and description from documentation
    const getDocumentation = React.useCallback((varName: string) => {
        if (!profileDocs) return { expectedValue: undefined, description: undefined, isSecret: false };

        const doc = profileDocs.environmentVariables.find(ev => ev.name === varName);
        return {
            expectedValue: doc?.expectedValue,
            description: doc?.description,
            isSecret: doc?.isSecret || false
        };
    }, [profileDocs]);

    // Extract variable name from value (for matching documentation)
    const extractVarNameFromValue = React.useCallback((value: string): string | null => {
        const match = value.match(/^\$\{([A-Z_][A-Z0-9_]*)/);
        return match ? match[1] : null;
    }, []);

    const handleUpdateVariable = React.useCallback((index: number, newValue: string) => {
        const updated = [...environmentVariables];
        updated[index] = { ...updated[index], value: newValue };
        onChange(updated);
    }, [environmentVariables, onChange]);

    const handleDeleteVariable = React.useCallback((index: number) => {
        onChange(environmentVariables.filter((_, i) => i !== index));
    }, [environmentVariables, onChange]);

    const handleDuplicateVariable = React.useCallback((index: number) => {
        const envVar = environmentVariables[index];
        const baseName = envVar.name.replace(/_COPY\d*$/, '');

        // Find next available copy number
        let copyNum = 1;
        while (environmentVariables.some(v => v.name === `${baseName}_COPY${copyNum}`)) {
            copyNum++;
        }

        const duplicated = {
            name: `${baseName}_COPY${copyNum}`,
            value: envVar.value
        };
        onChange([...environmentVariables, duplicated]);
    }, [environmentVariables, onChange]);

    const handleAddVariable = React.useCallback(() => {
        if (!newVarName.trim()) return;

        // Validate variable name format
        if (!/^[A-Z_][A-Z0-9_]*$/.test(newVarName.trim())) {
            return;
        }

        // Check for duplicates
        if (environmentVariables.some(v => v.name === newVarName.trim())) {
            return;
        }

        onChange([...environmentVariables, {
            name: newVarName.trim(),
            value: newVarValue.trim() || ''
        }]);

        // Reset form
        setNewVarName('');
        setNewVarValue('');
        setShowAddForm(false);
    }, [newVarName, newVarValue, environmentVariables, onChange]);

    return (
        <View style={{ marginBottom: 16 }}>
            {/* Section header */}
            <Text style={{
                fontSize: 14,
                fontWeight: '600',
                color: theme.colors.text,
                marginBottom: 12,
                ...Typography.default('semiBold')
            }}>
                {t("newSession.envVars.title")}
            </Text>

            {/* Add Variable Button */}
            <Pressable
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: theme.colors.button.primary.background,
                    borderRadius: theme.borderRadius.md,
                    paddingHorizontal: theme.margins.md,
                    paddingVertical: 6,
                    gap: 6,
                    marginBottom: theme.margins.md
                }}
                onPress={() => setShowAddForm(true)}
            >
                <Ionicons name="add" size={theme.iconSize.medium} color={theme.colors.button.primary.tint} />
                <Text style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: theme.colors.button.primary.tint,
                    ...Typography.default('semiBold')
                }}>
                    {t("newSession.envVars.addVariable")}
                </Text>
            </Pressable>

            {/* Add variable inline form */}
            {showAddForm && (
                <View style={{
                    backgroundColor: theme.colors.input.background,
                    borderRadius: theme.borderRadius.lg,
                    padding: theme.margins.md,
                    marginBottom: theme.margins.md,
                    borderWidth: 2,
                    borderColor: theme.colors.button.primary.background,
                }}>
                    <View>
                        <TextInput
                            style={{
                                backgroundColor: theme.colors.surface,
                                borderRadius: theme.borderRadius.lg,
                                padding: theme.margins.sm,
                                fontSize: 14,
                                color: theme.colors.text,
                                marginBottom: showSuggestions && filteredSuggestions.length > 0 ? 0 : theme.margins.sm,
                                borderWidth: 1,
                                borderColor: showSuggestions ? theme.colors.button.primary.background : theme.colors.textSecondary,
                                borderBottomLeftRadius: showSuggestions && filteredSuggestions.length > 0 ? 0 : theme.borderRadius.lg,
                                borderBottomRightRadius: showSuggestions && filteredSuggestions.length > 0 ? 0 : theme.borderRadius.lg,
                            }}
                            placeholder={t("newSession.envVars.varNamePlaceholder")}
                            placeholderTextColor={theme.colors.input.placeholder}
                            accessibilityLabel="Environment variable name"
                            value={newVarName}
                            onChangeText={(text) => {
                                setNewVarName(text);
                                setShowSuggestions(true);
                            }}
                            onFocus={() => setShowSuggestions(true)}
                            onBlur={() => {
                                // Delay hiding so tap on suggestion registers first
                                setTimeout(() => setShowSuggestions(false), 200);
                            }}
                            autoCapitalize="characters"
                            autoCorrect={false}
                        />
                        {showSuggestions && filteredSuggestions.length > 0 && (
                            <ScrollView
                                style={{
                                    maxHeight: 180,
                                    backgroundColor: theme.colors.surface,
                                    borderWidth: 1,
                                    borderTopWidth: 0,
                                    borderColor: theme.colors.button.primary.background,
                                    borderBottomLeftRadius: theme.borderRadius.lg,
                                    borderBottomRightRadius: theme.borderRadius.lg,
                                    marginBottom: theme.margins.sm,
                                }}
                                keyboardShouldPersistTaps="handled"
                                nestedScrollEnabled
                            >
                                {filteredSuggestions.map((suggestion, idx) => (
                                    <Pressable
                                        key={suggestion.name}
                                        onPress={() => {
                                            setNewVarName(suggestion.name);
                                            setShowSuggestions(false);
                                        }}
                                        style={({ pressed }) => ({
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            paddingHorizontal: 12,
                                            paddingVertical: 10,
                                            backgroundColor: pressed ? theme.colors.input.background : 'transparent',
                                            borderTopWidth: idx > 0 ? 0.5 : 0,
                                            borderTopColor: theme.colors.input.background,
                                        })}
                                    >
                                        <Text style={{
                                            fontSize: 13,
                                            color: theme.colors.text,
                                            flex: 1,
                                            ...Typography.default(),
                                        }}>
                                            {suggestion.name}
                                        </Text>
                                        <Text style={{
                                            fontSize: 11,
                                            color: theme.colors.textSecondary,
                                            marginLeft: 8,
                                            ...Typography.default(),
                                        }}>
                                            {suggestion.category}
                                        </Text>
                                    </Pressable>
                                ))}
                            </ScrollView>
                        )}
                    </View>
                    <TextInput
                        style={{
                            backgroundColor: theme.colors.surface,
                            borderRadius: theme.borderRadius.lg,
                            padding: theme.margins.sm,
                            fontSize: 14,
                            color: theme.colors.text,
                            marginBottom: theme.margins.md,
                            borderWidth: 1,
                            borderColor: theme.colors.textSecondary,
                        }}
                        placeholder={t("newSession.envVars.varValuePlaceholder")}
                        placeholderTextColor={theme.colors.input.placeholder}
                        accessibilityLabel="Environment variable value"
                        value={newVarValue}
                        onChangeText={setNewVarValue}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressable
                            style={{
                                flex: 1,
                                backgroundColor: theme.colors.surface,
                                borderRadius: 6,
                                padding: theme.margins.sm,
                                alignItems: 'center',
                                borderWidth: 1,
                                borderColor: theme.colors.textSecondary,
                            }}
                            onPress={() => {
                                setShowAddForm(false);
                                setNewVarName('');
                                setNewVarValue('');
                            }}
                        >
                            <Text style={{
                                fontSize: 14,
                                color: theme.colors.textSecondary,
                                ...Typography.default()
                            }}>
                                {t("common.cancel")}
                            </Text>
                        </Pressable>
                        <Pressable
                            style={{
                                flex: 1,
                                backgroundColor: theme.colors.button.primary.background,
                                borderRadius: 6,
                                padding: theme.margins.sm,
                                alignItems: 'center',
                            }}
                            onPress={handleAddVariable}
                        >
                            <Text style={{
                                fontSize: 14,
                                fontWeight: '600',
                                color: theme.colors.button.primary.tint,
                                ...Typography.default('semiBold')
                            }}>
                                {t("newSession.envVars.add")}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            )}

            {/* Variable cards */}
            {environmentVariables.map((envVar, index) => {
                const varNameFromValue = extractVarNameFromValue(envVar.value);
                const docs = getDocumentation(varNameFromValue || envVar.name);

                // Auto-detect secrets if not explicitly documented
                const isSecret = docs.isSecret || /TOKEN|KEY|SECRET|AUTH/i.test(envVar.name) || /TOKEN|KEY|SECRET|AUTH/i.test(varNameFromValue || '');

                return (
                    <EnvironmentVariableCard
                        key={index}
                        variable={envVar}
                        machineId={machineId}
                        expectedValue={docs.expectedValue}
                        description={docs.description}
                        isSecret={isSecret}
                        onUpdate={(newValue) => handleUpdateVariable(index, newValue)}
                        onDelete={() => handleDeleteVariable(index)}
                        onDuplicate={() => handleDuplicateVariable(index)}
                    />
                );
            })}
        </View>
    );
}
