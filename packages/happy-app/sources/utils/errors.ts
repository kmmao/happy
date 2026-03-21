export function getErrorMessage(error: unknown, fallback = "Unknown error"): string {
    return error instanceof Error ? error.message : fallback;
}

export class HappyError extends Error {
    readonly canTryAgain: boolean;

    constructor(message: string, canTryAgain: boolean) {
        super(message);
        this.canTryAgain = canTryAgain;
        this.name = 'RetryableError';
        Object.setPrototypeOf(this, HappyError.prototype);
    }
}