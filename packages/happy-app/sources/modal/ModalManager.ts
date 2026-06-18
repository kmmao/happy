/**
 * ModalManager — factory dispatching to a selected ModalAdapter.
 *
 * The native vs web branches that used to interleave inside every
 * method (`alert`, `confirm`, `prompt`) now live in two distinct
 * `ModalAdapter` implementations — `NativeModalAdapter` and
 * `WebModalAdapter` — in `./modalAdapter.ts`. This class is a thin
 * dispatch wrapper that picks the right adapter at `setFunctions`
 * time and forwards every call.
 *
 * The public surface (`IModal`) is unchanged; CLAUDE.md's "never use
 * Alert module — use @/modal instead" rule stays satisfied.
 *
 * `resolveConfirm` / `resolvePrompt` (called by `WebAlertModal` /
 * other web modal components after a button click) delegate to the
 * web adapter — that's where the resolver maps live. On native
 * platforms these are no-ops (resolution happens inside the
 * Alert.alert callback synchronously) but the IModal contract keeps
 * the methods so the web component code paths remain unchanged.
 */

import { AlertButton, ModalConfig, CustomModalConfig, IModal } from "./types";
import { log } from "@/log";

import {
  selectModalAdapter,
  type ModalAdapter,
  type WebModalAdapter,
} from "./modalAdapter";

class ModalManagerClass implements IModal {
  private showModalFn: ((config: Omit<ModalConfig, "id">) => string) | null =
    null;
  private hideModalFn: ((id: string) => void) | null = null;
  private hideAllModalsFn: (() => void) | null = null;
  private adapter: ModalAdapter | null = null;
  private webAdapter: WebModalAdapter | null = null;

  setFunctions(
    showModal: (config: Omit<ModalConfig, "id">) => string,
    hideModal: (id: string) => void,
    hideAllModals: () => void,
  ) {
    this.showModalFn = showModal;
    this.hideModalFn = hideModal;
    this.hideAllModalsFn = hideAllModals;

    const { adapter, webAdapter } = selectModalAdapter({
      showModalFn: showModal,
    });
    this.adapter = adapter;
    this.webAdapter = webAdapter;
  }

  alert(title: string, message?: string, buttons?: AlertButton[]): void {
    if (!this.adapter) {
      log.error(
        "ModalManager not initialized. Make sure ModalProvider is mounted.",
      );
      return;
    }
    this.adapter.alert(title, message, buttons);
  }

  async confirm(
    title: string,
    message?: string,
    options?: {
      cancelText?: string;
      confirmText?: string;
      destructive?: boolean;
    },
  ): Promise<boolean> {
    if (!this.adapter) {
      log.error(
        "ModalManager not initialized. Make sure ModalProvider is mounted.",
      );
      return false;
    }
    return this.adapter.confirm(title, message, options);
  }

  async prompt(
    title: string,
    message?: string,
    options?: {
      placeholder?: string;
      defaultValue?: string;
      cancelText?: string;
      confirmText?: string;
      inputType?: "default" | "secure-text" | "email-address" | "numeric";
    },
  ): Promise<string | null> {
    if (!this.adapter) {
      log.error(
        "ModalManager not initialized. Make sure ModalProvider is mounted.",
      );
      return null;
    }
    return this.adapter.prompt(title, message, options);
  }

  // toast / show / hide / hideAll are platform-agnostic — they always
  // route through the custom-modal infrastructure, so they don't need
  // adapter dispatch.

  toast(message: string, duration: number = 1500): void {
    if (!this.showModalFn) {
      return;
    }

    const id = this.showModalFn({
      type: "alert",
      title: message,
      buttons: [],
    } as Omit<ModalConfig, "id">);

    setTimeout(() => {
      this.hideModalFn?.(id);
    }, duration);
  }

  show(config: Omit<CustomModalConfig, "id" | "type">): string {
    if (!this.showModalFn) {
      log.error(
        "ModalManager not initialized. Make sure ModalProvider is mounted.",
      );
      return "";
    }

    return this.showModalFn({
      ...config,
      type: "custom",
    });
  }

  hide(id: string): void {
    if (!this.hideModalFn) {
      log.error(
        "ModalManager not initialized. Make sure ModalProvider is mounted.",
      );
      return;
    }

    this.hideModalFn(id);
  }

  hideAll(): void {
    if (!this.hideAllModalsFn) {
      log.error(
        "ModalManager not initialized. Make sure ModalProvider is mounted.",
      );
      return;
    }

    this.hideAllModalsFn();
  }

  // Web modal components call these after the user clicks a button.
  // Delegated to the web adapter where the resolver maps live. On
  // native the maps are empty (Alert.alert resolves inline), so the
  // calls are no-ops.

  resolveConfirm(id: string, value: boolean): void {
    this.webAdapter?.resolveConfirm(id, value);
  }

  resolvePrompt(id: string, value: string | null): void {
    this.webAdapter?.resolvePrompt(id, value);
  }
}

export const Modal = new ModalManagerClass();
