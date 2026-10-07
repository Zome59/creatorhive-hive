// How long a message stays on screen: long enough to read it calmly (about 190 words a minute, plus a
// moment to notice it), never under 3.5 s and never over 12 s.
export const READING = Object.freeze({ start: 1.5, perWord: 0.32, min: 3.5, max: 12 });

export function readingTime(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.min(READING.max, Math.max(READING.min, READING.start + words * READING.perWord));
}
