import type {
  ExecutionGuardSnapshot,
  ExecutionGuardTransition,
  ExecutionState,
  ExecutionTransitionReason,
} from "./types";

export class ExecutionGuard {
  private snapshot: ExecutionGuardSnapshot = {
    state: "idle",
    generation: 0,
    updatedAt: Date.now(),
  };

  constructor(
    private readonly onTransition?: (
      transition: ExecutionGuardTransition,
    ) => void,
  ) {}

  reserve(reason: ExecutionTransitionReason): boolean {
    if (this.snapshot.state !== "idle") {
      return false;
    }
    this.transition("dispatching", reason);
    return true;
  }

  cancelReservation(): boolean {
    if (this.snapshot.state !== "dispatching") {
      return false;
    }
    this.transition("idle");
    return true;
  }

  start(): number | null {
    switch (this.snapshot.state) {
      case "closed":
      case "aborting":
      case "running":
        return null;
      default: {
        const generation = this.snapshot.generation + 1;
        const reason = this.snapshot.activeReason ?? "user_message";
        this.transition("running", reason, generation);
        return generation;
      }
    }
  }

  interrupt(reason: ExecutionTransitionReason): boolean {
    switch (this.snapshot.state) {
      case "closed":
      case "aborting":
      case "idle":
        return false;
      default:
        this.transition("interrupting", reason);
        return true;
    }
  }

  requestRestart(reason: ExecutionTransitionReason): boolean {
    switch (this.snapshot.state) {
      case "closed":
      case "aborting":
        return false;
      default:
        this.transition("restarting", reason);
        return true;
    }
  }

  end(generation: number): boolean {
    if (this.snapshot.state === "closed") {
      return false;
    }
    if (this.snapshot.generation !== generation) {
      return false;
    }
    this.transition("idle", undefined, generation);
    return true;
  }

  abort(reason: ExecutionTransitionReason = "abort"): boolean {
    if (this.snapshot.state === "closed") {
      return false;
    }
    const generation = this.snapshot.generation + 1;
    this.transition("aborting", reason, generation);
    return true;
  }

  close(): void {
    if (this.snapshot.state === "closed") {
      return;
    }
    this.transition("closed");
  }

  getSnapshot(): ExecutionGuardSnapshot {
    return { ...this.snapshot };
  }

  get isActive(): boolean {
    return this.snapshot.state !== "idle" && this.snapshot.state !== "closed";
  }

  private transition(
    state: ExecutionState,
    reason: ExecutionTransitionReason | undefined = this.snapshot.activeReason,
    generation: number = this.snapshot.generation,
  ): void {
    const from = this.getSnapshot();
    this.snapshot = {
      state,
      generation,
      activeReason:
        state === "idle" || state === "closed" ? undefined : reason,
      updatedAt: Date.now(),
    };
    this.onTransition?.({ from, to: this.getSnapshot() });
  }
}
