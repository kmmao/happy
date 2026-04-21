import * as React from "react";
import { View, Pressable, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { Typography } from "@/constants/Typography";
import { layout } from "@/components/layout";
import { useInboxHasContent } from "@/hooks/useInboxHasContent";
import {
  resolveAppTabPresentation,
  type AppTabKey,
} from "./appTabPresentation";
import { resolveUiTabToneColors } from "./tabTone";

export type TabType = AppTabKey;

interface TabBarProps {
  activeTab: TabType;
  onTabPress: (tab: TabType) => void;
  inboxBadgeCount?: number;
  showOpenClaw?: boolean;
}

const styles = StyleSheet.create((theme) => ({
  outerContainer: {
    backgroundColor: theme.colors.groupped.background,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  innerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "stretch",
    maxWidth: layout.maxWidth,
    width: "100%",
    alignSelf: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: 18,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 4,
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: theme.colors.shadow.opacity * 0.4,
    shadowRadius: 10,
    elevation: 2,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    borderRadius: 14,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  tabActive: {
    backgroundColor: theme.dark
      ? theme.colors.accentPurple
      : theme.colors.header.tint,
  },
  tabPressed: {
    opacity: 0.9,
  },
  tabContent: {
    alignItems: "center",
    position: "relative",
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBadgeActive: {
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  label: {
    fontSize: 11,
    marginTop: 4,
    ...Typography.default(),
    textAlign: "center",
  },
  labelActive: {
    color: "#FFFFFF",
    ...Typography.default("semiBold"),
  },
  labelInactive: {
    color: theme.colors.textSecondary,
  },
  badge: {
    position: "absolute",
    top: -5,
    right: -8,
    backgroundColor: theme.colors.status.error,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: theme.colors.surface,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    ...Typography.default("semiBold"),
  },
  indicatorDot: {
    position: "absolute",
    top: -1,
    right: -1,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.header.tint,
    borderWidth: 1.5,
    borderColor: theme.colors.surface,
  },
}));

export const TabBar = React.memo(
  ({
    activeTab,
    onTabPress,
    inboxBadgeCount = 0,
    showOpenClaw = false,
  }: TabBarProps) => {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const inboxHasContent = useInboxHasContent();

    const tabs: { key: TabType; label: string }[] =
      React.useMemo(() => {
        const allTabs: { key: TabType; label: string }[] = [
          {
            key: "inbox",
            label: t("tabs.inbox"),
          },
          {
            key: "sessions",
            label: t("tabs.sessions"),
          },
          {
            key: "project",
            label: t("tabs.project"),
          },
          {
            key: "openclaw",
            label: t("tabs.openclaw"),
          },
          {
            key: "settings",
            label: t("tabs.settings"),
          },
        ];
        return allTabs.filter((tab) => {
          if (tab.key === "openclaw" && !showOpenClaw) return false;
          return true;
        });
      }, [showOpenClaw]);

    return (
      <View style={[styles.outerContainer, { paddingBottom: insets.bottom }]}>
        <View style={styles.innerContainer}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            const presentation = resolveAppTabPresentation(tab.key);
            const toneColors = resolveUiTabToneColors(presentation.tone, theme);

            return (
              <Pressable
                key={tab.key}
                style={({ pressed }) => [
                  styles.tab,
                  isActive && styles.tabActive,
                  pressed && styles.tabPressed,
                ]}
                onPress={() => onTabPress(tab.key)}
                hitSlop={8}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
              >
                <View style={styles.tabContent}>
                  <View
                    style={[
                      styles.iconBadge,
                      isActive
                        ? styles.iconBadgeActive
                        : { backgroundColor: toneColors.backgroundColor },
                    ]}
                  >
                    <Ionicons
                      name={presentation.icon}
                      size={18}
                      color={isActive ? "#FFFFFF" : toneColors.textColor}
                    />
                  </View>
                  {tab.key === "inbox" && inboxBadgeCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {inboxBadgeCount > 99 ? "99+" : inboxBadgeCount}
                      </Text>
                    </View>
                  )}
                  {tab.key === "inbox" &&
                    inboxHasContent &&
                    inboxBadgeCount === 0 && (
                      <View style={styles.indicatorDot} />
                    )}
                </View>
                <Text
                  style={[
                    styles.label,
                    isActive ? styles.labelActive : styles.labelInactive,
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  },
);
