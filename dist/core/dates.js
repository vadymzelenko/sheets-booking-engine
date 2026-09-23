"use strict";
// src/core/dates.ts
// Все даты в системе — строго ISO 8601 (UTC), чтобы избежать проблем с часовыми поясами.
Object.defineProperty(exports, "__esModule", { value: true });
exports.nowIso = nowIso;
exports.minutesAgoIso = minutesAgoIso;
exports.isRangeOverlap = isRangeOverlap;
exports.generateSlots = generateSlots;
function nowIso() {
    return new Date().toISOString();
}
function minutesAgoIso(minutes) {
    return new Date(Date.now() - minutes * 60_000).toISOString();
}
/** true, если интервалы [aStart, aEnd) и [bStart, bEnd) пересекаются */
function isRangeOverlap(aStart, aEnd, bStart, bEnd) {
    return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}
/** Разбивает диапазон [startTime, endTime) на слоты заданной длины (мин). */
function generateSlots(startTime, endTime, slotMinutes) {
    const slots = [];
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const step = slotMinutes * 60_000;
    for (let t = startMs; t + step <= endMs; t += step) {
        slots.push({
            startTime: new Date(t).toISOString(),
            endTime: new Date(t + step).toISOString(),
        });
    }
    return slots;
}
