export const TERMINAL_ROW_COLORS = [
  '#C6616C',
  '#E3A553',
  '#EBCB82',
  '#A7C18F',
  '#83C2D1',
  '#84A6C8',
  '#B28EAA',
  '#DDE3ED',
] as const;

export function getRowColor(rowIndex: number): string {
  return TERMINAL_ROW_COLORS[rowIndex % TERMINAL_ROW_COLORS.length];
}
