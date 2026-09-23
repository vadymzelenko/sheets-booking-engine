export declare function nowIso(): string;
export declare function minutesAgoIso(minutes: number): string;
/** true, если интервалы [aStart, aEnd) и [bStart, bEnd) пересекаются */
export declare function isRangeOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean;
/** Разбивает диапазон [startTime, endTime) на слоты заданной длины (мин). */
export declare function generateSlots(startTime: string, endTime: string, slotMinutes: number): {
    startTime: string;
    endTime: string;
}[];
