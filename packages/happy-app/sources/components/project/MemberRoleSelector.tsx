import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import { projectFormSheetStyles as pfs } from "./projectFormSheetStyles";
import {
    ROLE_COLORS,
    ROLE_ICONS,
    ROLE_LABELS,
    ROLES,
} from "./memberFormPresentation";

interface MemberRoleSelectorProps {
    role: string;
    isNew: boolean;
    isOwnerLocked: boolean;
    onRoleChange: (nextRole: string) => void;
}

export const MemberRoleSelector = React.memo(function MemberRoleSelector({
    role,
    isNew,
    isOwnerLocked,
    onRoleChange,
}: MemberRoleSelectorProps) {
    const { theme } = useUnistyles();

    return (
        <>
            <Text style={pfs.fieldLabel}>{t("members.roleLabel")}</Text>
            <View style={pfs.chipRow}>
                {ROLES.map((nextRole) => {
                    const isSelected = role === nextRole;
                    const isDisabled = !isNew && isOwnerLocked && nextRole !== "owner";

                    return (
                        <Pressable
                            key={nextRole}
                            style={[
                                pfs.chip,
                                isSelected && { backgroundColor: ROLE_COLORS[nextRole] },
                                isDisabled && { opacity: 0.3 },
                            ]}
                            onPress={() => {
                                if (!isDisabled) {
                                    onRoleChange(nextRole);
                                }
                            }}
                            disabled={isDisabled}
                        >
                            <Ionicons
                                name={(ROLE_ICONS[nextRole] ?? "person") as any}
                                size={14}
                                color={isSelected ? "#fff" : theme.colors.text}
                            />
                            <Text style={[pfs.chipText, isSelected && { color: "#fff" }]}>
                                {ROLE_LABELS[nextRole]?.() ?? nextRole}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </>
    );
});
