import type { ILockProvider } from "../../types";
export declare class MemoryLockAdapter implements ILockProvider {
    private locks;
    acquire(key: string, ttlMs: number): Promise<(() => Promise<void>) | null>;
    private cleanupExpired;
}
