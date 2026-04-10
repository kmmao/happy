export function getExpandedSidebarWidth(windowWidth: number): number {
  if (windowWidth <= 0) {
    return 320;
  }

  if (windowWidth < 900) {
    return Math.min(Math.max(Math.floor(windowWidth * 0.42), 320), 380);
  }

  if (windowWidth < 1280) {
    return Math.min(Math.max(Math.floor(windowWidth * 0.38), 340), 420);
  }

  return Math.min(Math.max(Math.floor(windowWidth * 0.3), 360), 420);
}
