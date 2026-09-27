/** Partition the whole recording without dropping or duplicating audio frames. */
export function sliceBounds(length: number, sampleRate: number, index: number) {
  const start = Math.floor(index * length / 256);
  const end = Math.floor((index + 1) * length / 256);
  return {offset: start / sampleRate, duration: (end - start) / sampleRate};
}
export function columnPads(pattern: readonly boolean[], column: number): number[] {
  return Array.from({length: 16}, (_, row) => row * 16 + column).filter(index => pattern[index]);
}
