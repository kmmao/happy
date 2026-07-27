import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";

export interface AppConfig {
  postHogKey?: string;
  revenueCatAppleKey?: string;
  revenueCatGoogleKey?: string;
  revenueCatStripeKey?: string;
  elevenLabsAgentId?: string;
  serverUrl?: string;
  /** Default base URL of an OpenAI Realtime compatible gateway (sub2api Live). */
  realtimeGatewayUrl?: string;
  /**
   * Default gateway API key. Convenience for local development only — every
   * EXPO_PUBLIC_* value is inlined into the JS bundle and can be extracted from
   * a shipped build, so leave this unset in release builds and let each user
   * supply their own key in Settings (which is end-to-end encrypted).
   */
  realtimeGatewayApiKey?: string;
  /** Default realtime output voice; empty lets the gateway pick. */
  realtimeVoice?: string;
}

/**
 * Loads app configuration from various manifest sources.
 * Looks for the "app" field in expoConfig.extra across different manifests
 * and merges them into a single configuration object.
 *
 * Priority (later overrides earlier):
 * 1. ExponentConstants native module manifest (fetches embedded manifest)
 * 2. Constants.expoConfig
 */
export function loadAppConfig(): AppConfig {
  const config: Partial<AppConfig> = {};

  try {
    // 1. Try ExponentConstants native module directly
    const ExponentConstants = requireOptionalNativeModule("ExponentConstants");
    if (ExponentConstants && ExponentConstants.manifest) {
      let exponentManifest = ExponentConstants.manifest;

      // On Android, manifest is passed as JSON string
      if (typeof exponentManifest === "string") {
        try {
          exponentManifest = JSON.parse(exponentManifest);
        } catch {
          // Failed to parse ExponentConstants.manifest
        }
      }

      // Look for app config in various locations
      const appConfig = exponentManifest?.extra?.app;
      if (appConfig && typeof appConfig === "object") {
        Object.assign(config, appConfig);
      }
    }
  } catch {
    // ExponentConstants not available
  }

  try {
    // 2. Try Constants.expoConfig
    if (Constants.expoConfig?.extra?.app) {
      const appConfig = Constants.expoConfig.extra.app;
      if (typeof appConfig === "object") {
        Object.assign(config, appConfig);
      }
    }
  } catch {
    // Constants.expoConfig not available
  }

  // Override with EXPO_PUBLIC_* env vars if present at runtime and different
  // Why: Native config is baked at prebuild time, but EXPO_PUBLIC_* vars
  // are available at runtime via process.env. This allows devs to change
  // keys without rebuilding native code.
  if (
    process.env.EXPO_PUBLIC_REVENUE_CAT_APPLE &&
    config.revenueCatAppleKey !== process.env.EXPO_PUBLIC_REVENUE_CAT_APPLE
  ) {
    config.revenueCatAppleKey = process.env.EXPO_PUBLIC_REVENUE_CAT_APPLE;
  }
  if (
    process.env.EXPO_PUBLIC_REVENUE_CAT_GOOGLE &&
    config.revenueCatGoogleKey !== process.env.EXPO_PUBLIC_REVENUE_CAT_GOOGLE
  ) {
    config.revenueCatGoogleKey = process.env.EXPO_PUBLIC_REVENUE_CAT_GOOGLE;
  }
  if (
    process.env.EXPO_PUBLIC_REVENUE_CAT_STRIPE &&
    config.revenueCatStripeKey !== process.env.EXPO_PUBLIC_REVENUE_CAT_STRIPE
  ) {
    config.revenueCatStripeKey = process.env.EXPO_PUBLIC_REVENUE_CAT_STRIPE;
  }
  if (
    process.env.EXPO_PUBLIC_POSTHOG_KEY &&
    config.postHogKey !== process.env.EXPO_PUBLIC_POSTHOG_KEY
  ) {
    config.postHogKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  }
  if (
    process.env.EXPO_PUBLIC_SERVER_URL &&
    config.serverUrl !== process.env.EXPO_PUBLIC_SERVER_URL
  ) {
    config.serverUrl = process.env.EXPO_PUBLIC_SERVER_URL;
  }
  if (
    process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID &&
    config.elevenLabsAgentId !== process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID
  ) {
    config.elevenLabsAgentId = process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID;
  }
  if (
    process.env.EXPO_PUBLIC_REALTIME_GATEWAY_URL &&
    config.realtimeGatewayUrl !== process.env.EXPO_PUBLIC_REALTIME_GATEWAY_URL
  ) {
    config.realtimeGatewayUrl = process.env.EXPO_PUBLIC_REALTIME_GATEWAY_URL;
  }
  if (
    process.env.EXPO_PUBLIC_REALTIME_GATEWAY_API_KEY &&
    config.realtimeGatewayApiKey !== process.env.EXPO_PUBLIC_REALTIME_GATEWAY_API_KEY
  ) {
    config.realtimeGatewayApiKey = process.env.EXPO_PUBLIC_REALTIME_GATEWAY_API_KEY;
  }
  if (
    process.env.EXPO_PUBLIC_REALTIME_VOICE &&
    config.realtimeVoice !== process.env.EXPO_PUBLIC_REALTIME_VOICE
  ) {
    config.realtimeVoice = process.env.EXPO_PUBLIC_REALTIME_VOICE;
  }

  return config as AppConfig;
}
