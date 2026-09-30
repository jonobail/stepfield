/** Zero-padded labels used for row (01–16) and slice (001–256) numbers. */
export function pad2(n: number) {
  return n.toString().padStart(2, '0');
}

export function pad3(n: number) {
  return n.toString().padStart(3, '0');
}
