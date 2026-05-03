import React from "react";
import { View, FlatList } from "react-native";
import { Text } from "@/components/StyledText";
import { useAllSessions, useSetting } from "@/sync/storage";
import { Session } from "@/sync/storageTypes";
import { Avatar } from "@/components/Avatar";
import {
  getSessionName,
  getSessionSubtitle,
  getSessionAvatarId,
  formatLastSeen,
  getSessionProviderKey,
} from "@/utils/sessionUtils";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { screenLayoutMaxWidth } from "@/components/layout";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { Pressable } from "react-native";
import { t } from "@/text";
import { SessionProviderTag } from "@/components/session/SessionProviderTag";

interface SessionHistoryItem {
  type: "session" | "date-header";
  session?: Session;
  date?: string;
}

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "stretch",
    backgroundColor: theme.colors.groupped.background,
  },
  subAgentBadge: {
    backgroundColor: theme.colors.textSecondary + "22",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginLeft: 4,
    alignSelf: "center",
  },
  subAgentBadgeText: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    ...Typography.default("semiBold"),
    letterSpacing: 0.2,
  },
  contentContainer: {
    flex: 1,
    maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
  },
  dateHeader: {
    backgroundColor: theme.colors.groupped.background,
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: 24,
  },
  dateHeaderText: {
    ...Typography.default("semiBold"),
    color: theme.colors.groupped.sectionTitle,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  sessionCard: {
    backgroundColor: theme.colors.surface,
    marginHorizontal: 16,
    marginBottom: 1,
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  sessionCardFirst: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  sessionCardLast: {
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    marginBottom: 12,
  },
  sessionCardSingle: {
    borderRadius: 12,
    marginBottom: 12,
  },
  sessionContent: {
    flex: 1,
    marginLeft: 16,
  },
  sessionTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 2,
  },
  sessionTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.text,
    flex: 1,
    ...Typography.default("semiBold"),
  },
  sessionSubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  sessionLastActive: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
    ...Typography.default(),
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: "center",
    ...Typography.default(),
  },
}));

function formatDateHeader(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const sessionDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );

  if (sessionDate.getTime() === today.getTime()) {
    return t("sessionHistory.today");
  } else if (sessionDate.getTime() === yesterday.getTime()) {
    return t("sessionHistory.yesterday");
  } else {
    const diffTime = today.getTime() - sessionDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return t("sessionHistory.daysAgo", { count: diffDays });
  }
}

function groupSessionsByDate(
  sessions: Session[],
  realtimeSessionSort: boolean,
): SessionHistoryItem[] {
  const sortKey = realtimeSessionSort ? "updatedAt" : "createdAt";
  const sortedSessions = sessions
    .slice()
    .sort((a, b) => b[sortKey] - a[sortKey]);

  const items: SessionHistoryItem[] = [];
  let currentDateGroup: Session[] = [];
  let currentDateString: string | null = null;

  for (const session of sortedSessions) {
    const sessionDate = new Date(session[sortKey]);
    const dateString = sessionDate.toDateString();

    if (currentDateString !== dateString) {
      // Process previous group
      if (currentDateGroup.length > 0) {
        items.push({
          type: "date-header",
          date: formatDateHeader(new Date(currentDateString!)),
        });
        currentDateGroup.forEach((sess) => {
          items.push({ type: "session", session: sess });
        });
      }

      // Start new group
      currentDateString = dateString;
      currentDateGroup = [session];
    } else {
      currentDateGroup.push(session);
    }
  }

  // Process final group
  if (currentDateGroup.length > 0) {
    items.push({
      type: "date-header",
      date: formatDateHeader(new Date(currentDateString!)),
    });
    currentDateGroup.forEach((sess) => {
      items.push({ type: "session", session: sess });
    });
  }

  return items;
}

function SessionHistory() {
  const safeArea = useSafeAreaInsets();
  const allSessions = useAllSessions();
  const realtimeSessionSort = useSetting("realtimeSessionSort");
  const navigateToSession = useNavigateToSession();

  const groupedItems = React.useMemo(() => {
    return groupSessionsByDate(allSessions, realtimeSessionSort);
  }, [allSessions, realtimeSessionSort]);

  const renderItem = React.useCallback(
    ({ item, index }: { item: SessionHistoryItem; index: number }) => {
      if (item.type === "date-header") {
        return (
          <View style={styles.dateHeader}>
            <Text style={styles.dateHeaderText}>{item.date}</Text>
          </View>
        );
      }

      if (item.type === "session" && item.session) {
        const session = item.session;
        const sessionName = getSessionName(session);
        const sessionSubtitle = getSessionSubtitle(session);
        const avatarId = getSessionAvatarId(session);
        const providerKey = getSessionProviderKey(session);

        // Determine card styling based on position within date group
        const prevItem = index > 0 ? groupedItems[index - 1] : null;
        const nextItem =
          index < groupedItems.length - 1 ? groupedItems[index + 1] : null;

        const isFirst = prevItem?.type === "date-header";
        const isLast = nextItem?.type === "date-header" || nextItem == null;
        const isSingle = isFirst && isLast;

        return (
          <Pressable
            style={[
              styles.sessionCard,
              isSingle
                ? styles.sessionCardSingle
                : isFirst
                  ? styles.sessionCardFirst
                  : isLast
                    ? styles.sessionCardLast
                    : {},
            ]}
            onPress={() => navigateToSession(session.id)}
          >
            <Avatar
              id={avatarId}
              size={48}
              flavor={session.metadata?.flavor}
              provider={providerKey}
            />
            <View style={styles.sessionContent}>
              <View style={styles.sessionTitleRow}>
                <Text style={styles.sessionTitle} numberOfLines={1}>
                  {sessionName}
                </Text>
                {session.parentSessionId ? (
                  <View style={styles.subAgentBadge}>
                    <Text style={styles.subAgentBadgeText}>Sub</Text>
                  </View>
                ) : null}
                <SessionProviderTag session={session} includeModel />
              </View>
              <Text style={styles.sessionSubtitle} numberOfLines={1}>
                {sessionSubtitle}
              </Text>
              <Text style={styles.sessionLastActive} numberOfLines={1}>
                {formatLastSeen(session.activeAt, session.active)}
              </Text>
            </View>
          </Pressable>
        );
      }

      return null;
    },
    [groupedItems, navigateToSession],
  );

  const keyExtractor = React.useCallback(
    (item: SessionHistoryItem, index: number) => {
      if (item.type === "date-header") {
        return `date-${item.date}-${index}`;
      }
      if (item.type === "session" && item.session) {
        return `session-${item.session.id}`;
      }
      return `item-${index}`;
    },
    [],
  );

  if (!allSessions) {
    return (
      <View style={styles.container}>
        <View style={styles.contentContainer} />
      </View>
    );
  }

  if (groupedItems.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.contentContainer}>
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t("sessionHistory.empty")}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.contentContainer}>
        <FlatList
          data={groupedItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{
            paddingBottom: safeArea.bottom + 16,
            paddingTop: 8,
          }}
        />
      </View>
    </View>
  );
}

export default React.memo(SessionHistory);
