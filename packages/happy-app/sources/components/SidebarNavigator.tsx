import { useAuth } from "@/auth/AuthContext";
import * as React from "react";
import { Drawer } from "expo-router/drawer";
import { useIsTablet } from "@/utils/responsive";
import { SidebarView } from "./SidebarView";
import { useWindowDimensions } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { SidebarStateProvider, useSidebarState } from "./SidebarStateContext";

const COLLAPSED_RAIL_WIDTH = 52;

const SidebarNavigatorInner = React.memo(() => {
  const auth = useAuth();
  const isTablet = useIsTablet();
  const showPermanentDrawer = auth.isAuthenticated && isTablet;
  const { width: windowWidth } = useWindowDimensions();
  const { collapsed } = useSidebarState();
  const { theme } = useUnistyles();

  const drawerWidth = React.useMemo(() => {
    if (!showPermanentDrawer) return 280;
    return Math.min(Math.max(Math.floor(windowWidth * 0.3), 250), 360);
  }, [windowWidth, showPermanentDrawer]);

  const drawerNavigationOptions = React.useMemo(() => {
    if (!showPermanentDrawer) {
      return {
        lazy: false,
        headerShown: false,
        drawerType: "front" as const,
        swipeEnabled: false,
        drawerStyle: {
          width: 0,
          display: "none" as const,
        },
      };
    }

    return {
      lazy: false,
      headerShown: false,
      drawerType: "permanent" as const,
      drawerStyle: {
        backgroundColor: theme.colors.groupped.background,
        borderRightWidth: 0,
        width: collapsed ? COLLAPSED_RAIL_WIDTH : drawerWidth,
      },
      swipeEnabled: false,
      drawerActiveTintColor: "transparent",
      drawerInactiveTintColor: "transparent",
      drawerItemStyle: { display: "none" as const },
      drawerLabelStyle: { display: "none" as const },
    };
  }, [showPermanentDrawer, drawerWidth, collapsed, theme]);

  const drawerContent = React.useCallback(() => <SidebarView />, []);

  return (
    <Drawer
      screenOptions={drawerNavigationOptions}
      drawerContent={showPermanentDrawer ? drawerContent : undefined}
    />
  );
});

export const SidebarNavigator = React.memo(() => {
  return (
    <SidebarStateProvider>
      <SidebarNavigatorInner />
    </SidebarStateProvider>
  );
});
