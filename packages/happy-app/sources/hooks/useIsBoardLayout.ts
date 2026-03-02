import { Platform, useWindowDimensions } from "react-native";
import { useIsTablet } from "@/utils/responsive";
import { isRunningOnMac } from "@/utils/platform";

/** Minimum width (px) to show multi-column board on web / Mac Catalyst */
const MIN_BOARD_WIDTH = 768;

/**
 * Returns true when the kanban board should render as a multi-column layout.
 * True for: Mac (Catalyst ≥768px), tablet, web (≥768px wide).
 * False for: phone (native), narrow web/Mac windows.
 */
export function useIsBoardLayout(): boolean {
  const isTablet = useIsTablet();
  const { width } = useWindowDimensions();
  if (Platform.OS === "web") return width >= MIN_BOARD_WIDTH;
  if (isRunningOnMac()) return width >= MIN_BOARD_WIDTH;
  return isTablet;
}
