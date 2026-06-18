/**
 * modalAdapter — split native + web modal implementations behind one
 * `ModalAdapter` interface so `ModalManager` becomes a thin
 * platform-selection factory.
 *
 * Why split
 * ---------
 * Before this seam every method on `ModalManagerClass` (`alert`,
 * `confirm`, `prompt`) branched on `Platform.OS === "web"` inline,
 * interleaving two distinct implementations in one class body:
 *
 *   - the web path managed a `confirmResolvers` / `promptResolvers`
 *     Map driven by `setFunctions(showModal, hideModal, …)` + the
 *     custom modal components,
 *   - the native path called RN's `Alert.alert` (and `Alert.prompt` on
 *     iOS).
 *
 * Two implementations live as branches of the same method body is the
 * "two adapters hiding as one module" smell (LANGUAGE.md). Splitting
 * makes each adapter independently testable, each platform's quirks
 * live in one file, and the manager shrinks to a dispatch wrapper.
 *
 * The interface
 * -------------
 * Both adapters implement the same shape:
 *
 *   alert(title, message?, buttons?) → void
 *   confirm(title, message?, options?) → Promise<boolean>
 *   prompt(title, message?, options?) → Promise<string | null>
 *
 * The native adapter holds a reference to the web adapter for the one
 * fallback case where iOS's `Alert.prompt` can't honour an `inputType`
 * — Android always falls back too, and that single fallback lives
 * inside the native adapter rather than leaking back into the manager.
 *
 * `resolveConfirm` / `resolvePrompt` live on the web adapter (where
 * the resolvers were created). The manager delegates the resolve calls
 * unchanged, so `WebAlertModal` (and other web modal components) keep
 * their existing `Modal.resolveConfirm(id, value)` call sites.
 */

import { Platform, Alert } from "react-native";
import { t } from "@/text";

import type {
  AlertButton,
  ModalConfig,
} from "./types";

type ConfirmOptions = {
  cancelText?: string;
  confirmText?: string;
  destructive?: boolean;
};

type PromptOptions = {
  placeholder?: string;
  defaultValue?: string;
  cancelText?: string;
  confirmText?: string;
  inputType?: "default" | "secure-text" | "email-address" | "numeric";
};

/**
 * The shared adapter contract — `ModalManager` programs only against
 * this. Test doubles satisfy this and drop into the manager unchanged.
 */
export interface ModalAdapter {
  alert(title: string, message?: string, buttons?: AlertButton[]): void;
  confirm(
    title: string,
    message?: string,
    options?: ConfirmOptions,
  ): Promise<boolean>;
  prompt(
    title: string,
    message?: string,
    options?: PromptOptions,
  ): Promise<string | null>;
}

type ShowModalFn = (config: Omit<ModalConfig, "id">) => string;

/**
 * Web (and Android prompt-with-inputType) adapter. Routes every call
 * through the custom modal components driven by `showModalFn`. Owns
 * the confirm / prompt resolver maps — the components call back via
 * `resolveConfirm` / `resolvePrompt` after a button click.
 */
export class WebModalAdapter implements ModalAdapter {
  private readonly confirmResolvers = new Map<string, (v: boolean) => void>();
  private readonly promptResolvers = new Map<
    string,
    (v: string | null) => void
  >();

  constructor(private readonly showModalFn: ShowModalFn) {}

  alert(title: string, message?: string, buttons?: AlertButton[]): void {
    this.showModalFn({
      type: "alert",
      title,
      message,
      buttons: buttons || [{ text: t("common.ok") }],
    } as Omit<ModalConfig, "id">);
  }

  confirm(
    title: string,
    message?: string,
    options?: ConfirmOptions,
  ): Promise<boolean> {
    const modalId = this.showModalFn({
      type: "confirm",
      title,
      message,
      cancelText: options?.cancelText,
      confirmText: options?.confirmText,
      destructive: options?.destructive,
    } as Omit<ModalConfig, "id">);
    return new Promise<boolean>((resolve) => {
      this.confirmResolvers.set(modalId, resolve);
    });
  }

  prompt(
    title: string,
    message?: string,
    options?: PromptOptions,
  ): Promise<string | null> {
    const modalId = this.showModalFn({
      type: "prompt",
      title,
      message,
      placeholder: options?.placeholder,
      defaultValue: options?.defaultValue,
      cancelText: options?.cancelText,
      confirmText: options?.confirmText,
      inputType: options?.inputType,
    } as Omit<ModalConfig, "id">);
    return new Promise<string | null>((resolve) => {
      this.promptResolvers.set(modalId, resolve);
    });
  }

  /** Called by web modal components after a confirm button click. */
  resolveConfirm(id: string, value: boolean): void {
    const resolver = this.confirmResolvers.get(id);
    if (resolver) {
      resolver(value);
      this.confirmResolvers.delete(id);
    }
  }

  /** Called by web modal components after a prompt submit / cancel. */
  resolvePrompt(id: string, value: string | null): void {
    const resolver = this.promptResolvers.get(id);
    if (resolver) {
      resolver(value);
      this.promptResolvers.delete(id);
    }
  }
}

/**
 * Native (iOS + Android) adapter. Uses RN's `Alert.alert` for
 * alert/confirm and `Alert.prompt` for iOS prompts without a custom
 * `inputType`. For Android prompts and iOS prompts with an `inputType`,
 * delegates to the web adapter (the custom modal supports
 * `secure-text` / `email-address` / `numeric` — `Alert.prompt` does
 * not).
 */
export class NativeModalAdapter implements ModalAdapter {
  constructor(private readonly fallback: WebModalAdapter) {}

  alert(title: string, message?: string, buttons?: AlertButton[]): void {
    Alert.alert(title, message, buttons);
  }

  confirm(
    title: string,
    message?: string,
    options?: ConfirmOptions,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      Alert.alert(
        title,
        message,
        [
          {
            text: options?.cancelText || t("common.cancel"),
            style: "cancel",
            onPress: () => resolve(false),
          },
          {
            text: options?.confirmText || t("common.ok"),
            style: options?.destructive ? "destructive" : "default",
            onPress: () => resolve(true),
          },
        ],
        { cancelable: false },
      );
    });
  }

  prompt(
    title: string,
    message?: string,
    options?: PromptOptions,
  ): Promise<string | null> {
    if (Platform.OS === "ios" && !options?.inputType) {
      return new Promise<string | null>((resolve) => {
        // @ts-ignore - Alert.prompt is iOS-only
        Alert.prompt(
          title,
          message,
          [
            {
              text: options?.cancelText || t("common.cancel"),
              style: "cancel",
              onPress: () => resolve(null),
            },
            {
              text: options?.confirmText || t("common.ok"),
              onPress: (text?: string) => resolve(text || null),
            },
          ],
          "plain-text",
          options?.defaultValue,
          "default",
        );
      });
    }
    // Android prompts (and iOS prompts that need a richer inputType
    // RN's Alert.prompt can't render) fall through to the web modal.
    return this.fallback.prompt(title, message, options);
  }
}

/**
 * Choose which adapter to wire at `ModalManager.setFunctions` time.
 * The platform check happens once; subsequent calls dispatch through
 * the selected adapter with no per-call branching.
 */
export function selectModalAdapter(args: {
  showModalFn: ShowModalFn;
}): { adapter: ModalAdapter; webAdapter: WebModalAdapter } {
  const webAdapter = new WebModalAdapter(args.showModalFn);
  const nativeAdapter = new NativeModalAdapter(webAdapter);
  return {
    adapter: Platform.OS === "web" ? webAdapter : nativeAdapter,
    webAdapter,
  };
}
