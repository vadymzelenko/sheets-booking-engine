"use strict";
// src/adapters/lock/MemoryLockAdapter.ts
// Дефолтная реализация ILockProvider — лок в памяти процесса.
//
// Подходит для одного долгоживущего инстанса Node (VPS, контейнер) или для dev-режима.
// В serverless-среде с несколькими параллельными инстансами (Vercel functions) память
// не общая между вызовами — тогда реализуйте свой ILockProvider (например, на Redis)
// и передайте его в BookingEngine через конструктор, без правок в бизнес-логике.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryLockAdapter = void 0;
class MemoryLockAdapter {
    constructor() {
        this.locks = new Map();
    }
    async acquire(key, ttlMs) {
        this.cleanupExpired(key);
        const existing = this.locks.get(key);
        if (existing && existing.expiresAt > Date.now()) {
            return null;
        }
        // Небольшая случайная задержка + повторная проверка снижает шанс гонки
        // при двух почти одновременных запросах на один и тот же слот.
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 30));
        const recheck = this.locks.get(key);
        if (recheck && recheck.expiresAt > Date.now()) {
            return null;
        }
        const expiresAt = Date.now() + ttlMs;
        this.locks.set(key, { expiresAt });
        return async () => {
            const current = this.locks.get(key);
            // снимаем лок, только если это именно та блокировка, которую мы поставили
            if (current && current.expiresAt === expiresAt) {
                this.locks.delete(key);
            }
        };
    }
    cleanupExpired(key) {
        const entry = this.locks.get(key);
        if (entry && entry.expiresAt <= Date.now()) {
            this.locks.delete(key);
        }
    }
}
exports.MemoryLockAdapter = MemoryLockAdapter;
