import * as React from "react";
import { Animated, View } from "react-native";
import { Image } from "expo-image";
import { AvatarSkia } from "./AvatarSkia";
import { AvatarGradient } from "./AvatarGradient";
import { AvatarBrutalist } from "./AvatarBrutalist";
import { useSetting } from "@/sync/storage";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

interface AvatarProps {
  id: string;
  title?: boolean;
  square?: boolean;
  size?: number;
  monochrome?: boolean;
  flavor?: string | null;
  provider?: string | null;
  imageUrl?: string | null;
  thumbhash?: string | null;
  hasUnreadMessages?: boolean;
  glowColor?: string | null;
}

/** Pulsing glow ring rendered behind the avatar. */
const GlowRing = React.memo(({ size, color }: { size: number; color: string }) => {
  const opacity = React.useRef(new Animated.Value(0.4)).current;

  React.useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  const ringSize = size + 6;
  return (
    <Animated.View
      style={{
        position: "absolute",
        top: -3,
        left: -3,
        width: ringSize,
        height: ringSize,
        borderRadius: ringSize / 2,
        borderWidth: 1.5,
        borderColor: color,
        opacity,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 4,
        elevation: 4,
      }}
      pointerEvents="none"
    />
  );
});

const flavorIcons = {
  claude: require("@/assets/images/icon-claude.png"),
  codex: require("@/assets/images/icon-gpt.png"),
  gemini: require("@/assets/images/icon-gemini.png"),
  deepseek: require("@/assets/images/icon-deepseek.png"),
  zai: require("@/assets/images/icon-zai.png"),
  minimax: require("@/assets/images/icon-minimax.png"),
  kimi: require("@/assets/images/icon-kimi.png"),
  "azure-openai": require("@/assets/images/icon-azure-openai.png"),
  opencode: require("@/assets/images/openclaw-icon-color.png"),
  acp: require("@/assets/images/openclaw-icon-color.png"),
};

function normalizeProviderKey(
  value: string | null | undefined,
): keyof typeof flavorIcons | null {
  const key = value?.toLowerCase();
  if (!key || key.trim().length === 0) {
    return null;
  }
  if (key === "deepseek") {
    return "deepseek";
  }
  if (key === "zai" || key === "z.ai" || key.includes("chatglm")) {
    return "zai";
  }
  if (key === "minimax") {
    return "minimax";
  }
  if (key === "kimi" || key.includes("moonshot")) {
    return "kimi";
  }
  if (key === "azure-openai" || (key.includes("azure") && key.includes("openai"))) {
    return "azure-openai";
  }
  if (key === "openai" || key === "gpt") {
    return "codex";
  }
  if (key === "codex") {
    return "codex";
  }
  if (key === "claude" || key === "anthropic") {
    return "claude";
  }
  if (key === "opencode") {
    return "opencode";
  }
  if (key === "acp") {
    return "acp";
  }
  if (key === "gemini") {
    return "gemini";
  }
  return null;
}

function resolveIconKey(
  provider: string | null | undefined,
  flavor: string | null | undefined,
): keyof typeof flavorIcons {
  return normalizeProviderKey(provider) ?? normalizeProviderKey(flavor) ?? "claude";
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
  },
  flavorIcon: {
    position: "absolute",
    bottom: -2,
    right: -2,
    backgroundColor: theme.colors.surface,
    borderRadius: 100,
    overflow: "hidden",
    padding: 2,
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  unreadBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    backgroundColor: theme.colors.textLink,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: theme.colors.surface,
  },
  iconMask: {
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  iconFill: {
    borderRadius: 999,
  },
}));

export const Avatar = React.memo((props: AvatarProps) => {
  const {
    flavor,
    provider,
    size = 48,
    imageUrl,
    thumbhash,
    hasUnreadMessages,
    glowColor,
    ...avatarProps
  } = props;
  const avatarStyle = useSetting("avatarStyle");
  const showFlavorIcons = useSetting("showFlavorIcons");
  const { theme } = useUnistyles();
  const glowElement = glowColor ? <GlowRing size={size} color={glowColor} /> : null;

  const unreadBadgeSize = Math.round(size * 0.22);
  const unreadBadgeElement = hasUnreadMessages ? (
    <View
      style={[
        styles.unreadBadge,
        { width: unreadBadgeSize, height: unreadBadgeSize },
      ]}
    />
  ) : null;

  // Render custom image if provided
  if (imageUrl) {
    const imageElement = (
      <Image
        source={{ uri: imageUrl, thumbhash: thumbhash || undefined }}
        placeholder={thumbhash ? { thumbhash: thumbhash } : undefined}
        contentFit="cover"
        style={{
          width: size,
          height: size,
          borderRadius: avatarProps.square ? 0 : size / 2,
        }}
      />
    );

    const showFlavorOverlay = showFlavorIcons && (provider || flavor);
    if (showFlavorOverlay || hasUnreadMessages || glowElement) {
      const normalizedFlavor = resolveIconKey(provider, flavor);
      const flavorIcon = flavorIcons[normalizedFlavor];
      const circleSize = Math.round(size * 0.35);
      const iconSize =
        normalizedFlavor === "codex"
          ? Math.round(size * 0.25)
          : normalizedFlavor === "claude"
            ? Math.round(size * 0.28)
            : Math.round(size * 0.35);

      return (
        <View style={[styles.container, { width: size, height: size }]}>
          {glowElement}
          {imageElement}
          {showFlavorOverlay && (
            <View
              style={[
                styles.flavorIcon,
                {
                  width: circleSize,
                  height: circleSize,
                  alignItems: "center",
                  justifyContent: "center",
                },
              ]}
            >
              <View style={[styles.iconMask, { width: iconSize, height: iconSize }]}>
                <Image
                  source={flavorIcon}
                  style={[styles.iconFill, { width: iconSize, height: iconSize }]}
                  contentFit="contain"
                  tintColor={
                    normalizedFlavor === "codex" ? theme.colors.text : undefined
                  }
                />
              </View>
            </View>
          )}
          {unreadBadgeElement}
        </View>
      );
    }

    return imageElement;
  }

  // Original generated avatar logic
  // Determine which avatar variant to render
  let AvatarComponent: React.ComponentType<any>;
  if (avatarStyle === "pixelated") {
    AvatarComponent = AvatarSkia;
  } else if (avatarStyle === "brutalist") {
    AvatarComponent = AvatarBrutalist;
  } else {
    AvatarComponent = AvatarGradient;
  }

  // Determine flavor icon for generated avatars
  const normalizedFlavor = resolveIconKey(provider, flavor);
  const flavorIcon = flavorIcons[normalizedFlavor];
  // Make icons smaller while keeping same circle size
  // Claude slightly bigger than codex
  const circleSize = Math.round(size * 0.35);
  const iconSize =
    normalizedFlavor === "codex"
      ? Math.round(size * 0.25)
      : normalizedFlavor === "claude"
        ? Math.round(size * 0.28)
        : Math.round(size * 0.35);

  if (showFlavorIcons || hasUnreadMessages || glowElement) {
    return (
      <View style={[styles.container, { width: size, height: size }]}>
        {glowElement}
        <AvatarComponent {...avatarProps} size={size} />
        {showFlavorIcons && (
          <View
            style={[
              styles.flavorIcon,
              {
                width: circleSize,
                height: circleSize,
                alignItems: "center",
                justifyContent: "center",
              },
            ]}
          >
            <View style={[styles.iconMask, { width: iconSize, height: iconSize }]}>
              <Image
                source={flavorIcon}
                style={[styles.iconFill, { width: iconSize, height: iconSize }]}
                contentFit="contain"
                tintColor={
                  normalizedFlavor === "codex" ? theme.colors.text : undefined
                }
              />
            </View>
          </View>
        )}
        {unreadBadgeElement}
      </View>
    );
  }

  // Return avatar without wrapper when not showing flavor icons
  return <AvatarComponent {...avatarProps} size={size} />;
});
