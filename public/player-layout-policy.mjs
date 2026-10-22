// Keep a generous dead band between the two layouts. Keyboard movement is not a gesture.
export function nextPlayerLayout({compact, deckTop, dockTop, locked=false}) {
  if (locked) return compact;
  const distance=deckTop-dockTop;
  return compact ? distance<64 : distance<=8;
}
export function keyboardVisible({focused, wasOpen, baseline, height, scale=1}) {
  return Math.abs(scale-1)<.05 && (focused || wasOpen) && baseline-height>140;
}
