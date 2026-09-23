// src/core/dates.ts
// Все даты в системе — строго ISO 8601 (UTC), чтобы избежать проблем с часовыми поясами.

export function nowIso(): string {
  return new Date().toISOString();
}

export function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** true, если интервалы [aStart, aEnd) и [bStart, bEnd) пересекаются */
export function isRangeOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

/** Разбивает диапазон [startTime, endTime) на слоты заданной длины (мин). */
export function generateSlots(
  startTime: string,
  endTime: string,
  slotMinutes: number
): { startTime: string; endTime: string }[] {
  const slots: { startTime: string; endTime: string }[] = [];
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
