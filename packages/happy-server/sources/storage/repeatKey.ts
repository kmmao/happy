import { Tx } from "@/storage/inTx";

function hasPrismaErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: string }).code === code;
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
    return hasPrismaErrorCode(error, "P2002");
}

function isPrismaRecordMissingError(error: unknown): boolean {
    return hasPrismaErrorCode(error, "P2025");
}

export async function fetchRepeatKey(tx: Tx, key: string) {
    let session = await tx.repeatKey.findUnique({ where: { key, expiresAt: { gte: new Date() } } });
    if (session) {
        return session.value;
    } else {
        return null;
    }
}

export async function saveRepeatKey(tx: Tx, key: string, value: string, timeout: number = Date.now() + (1000 * 60 * 60 * 24) /* 1 day */) {
    await tx.repeatKey.upsert({
        where: { key },
        create: { key, value, expiresAt: new Date(timeout) },
        update: { key, value, expiresAt: new Date(timeout) }
    });
}

export async function claimRepeatKey(tx: Tx, key: string, value: string, timeout: number = Date.now() + (1000 * 60 * 60 * 24) /* 1 day */): Promise<boolean> {
    const now = new Date();
    const existing = await tx.repeatKey.findUnique({ where: { key } });
    if (existing && existing.expiresAt >= now) {
        return false;
    }
    if (existing) {
        try {
            await tx.repeatKey.delete({ where: { key } });
        } catch (error) {
            if (isPrismaRecordMissingError(error)) {
                return false;
            }
            throw error;
        }
    }
    try {
        await tx.repeatKey.create({
            data: { key, value, expiresAt: new Date(timeout) },
        });
        return true;
    } catch (error) {
        if (isPrismaUniqueConstraintError(error)) {
            return false;
        }
        throw error;
    }
}

export async function repeatKey(tx: Tx, key: string, value: string, timeout: number = Date.now() + (1000 * 60 * 60 * 24) /* 1 day */): Promise<boolean> {
    return claimRepeatKey(tx, key, value, timeout);
}