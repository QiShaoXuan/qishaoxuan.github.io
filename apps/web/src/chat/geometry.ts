export type Point = { x: number; y: number };
export type Viewport = { width: number; height: number };
export type DockSide = 'left' | 'right';

export function floatingSize(viewport: Viewport) {
  return { width: Math.max(0, Math.min(400, viewport.width - 16)), height: Math.max(0, Math.min(580, viewport.height - 16)) };
}

export function clampPosition(point: Point, viewport: Viewport): Point {
  const size = floatingSize(viewport);
  const margin = Math.min(8, viewport.width / 2, viewport.height / 2);
  return {
    x: Math.max(margin, Math.min(point.x, viewport.width - size.width - margin)),
    y: Math.max(margin, Math.min(point.y, viewport.height - size.height - margin)),
  };
}

export function initialPosition(viewport: Viewport): Point {
  const size = floatingSize(viewport);
  return clampPosition({ x: viewport.width - size.width - 24, y: viewport.height - size.height - 24 }, viewport);
}

export function dockTarget(pointerX: number, viewportWidth: number): DockSide | null {
  if (viewportWidth < 768) return null;
  if (pointerX <= 64) return 'left';
  if (pointerX >= viewportWidth - 64) return 'right';
  return null;
}

export function passedDragThreshold(start: Point, current: Point): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > 4;
}
