declare module "react-test-renderer" {
  import type * as React from "react";

  export interface ReactTestRenderer {
    update(element: React.ReactElement | null): void;
    unmount(): void;
  }

  export function create(
    element: React.ReactElement | null,
  ): ReactTestRenderer;

  export function act(callback: () => void): void;
}
