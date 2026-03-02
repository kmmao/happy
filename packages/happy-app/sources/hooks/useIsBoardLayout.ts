import { Platform, useWindowDimensions } from "react-native";
import { useIsTablet } from "@/utils/responsive";
import { isRunningOnMac } from "@/utils/platform";

/** Minimum width (px) to show multi-column board on web */
const MIN_BOARD_WIDTH = 600;

/**
 * Returns true when the kanban board should render as a multi-column layout.
 * True for: Mac (Catalyst), tablet, web (≥600px wide).
 * False for: phone (native), narrow web windows.
 */
export function useIsBoardLayout(): boolean {
  const isTablet = useIsTablet();
  const { width } = useWindowDimensions();
  if (Platform.OS === "web") return width >= MIN_BOARD_WIDTH;
  if (isRunningOnMac()) return true;
  return isTablet;
}
