/** @type {const} */
const themeColors = {
  // Vintage resale palette — exact swatch values. In sync with constants/vintage.ts.
  // Used by useColors() hook → results.tsx, loading.tsx, and old screens.
  primary:    { light: '#3D5A38', dark: '#3D5A38' },  // Deep Green swatch
  background: { light: '#ECE7D3', dark: '#ECE7D3' },  // Antique Cream swatch
  surface:    { light: '#F2EDD8', dark: '#F2EDD8' },  // Antique Cream lighter (cards)
  foreground: { light: '#3D2A12', dark: '#3D2A12' },  // warm near-black brown
  muted:      { light: '#A8906E', dark: '#A8906E' },  // Aged Brown lighter
  border:     { light: '#C8B88A', dark: '#C8B88A' },  // Subtle Sepia + Warm Beige
  success:    { light: '#3D5A38', dark: '#3D5A38' },  // Deep Green = profit
  warning:    { light: '#BE9C2C', dark: '#BE9C2C' },  // Vintage Gold = risky
  error:      { light: '#9E3A2A', dark: '#9E3A2A' },  // muted vintage red
};

module.exports = { themeColors };