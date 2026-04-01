import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";

export type MachineNavigationSummaryItemProps = {
  groupTitle: string;
  title: string;
  subtitle: string;
  iconName: React.ComponentProps<typeof Ionicons>["name"];
  iconColor: string;
  onPress: () => void;
};

export const MachineNavigationSummaryItem = React.memo(
  function MachineNavigationSummaryItem({
    groupTitle,
    title,
    subtitle,
    iconName,
    iconColor,
    onPress,
  }: MachineNavigationSummaryItemProps) {
    return (
      <ItemGroup title={groupTitle}>
        <Item
          title={title}
          subtitle={subtitle}
          icon={<Ionicons name={iconName} size={20} color={iconColor} />}
          onPress={onPress}
          showChevron
        />
      </ItemGroup>
    );
  },
);
