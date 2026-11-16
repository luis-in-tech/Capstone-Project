export type DoorEdge = 'top' | 'bottom' | 'left' | 'right';
export type ShapeKind = 'box' | 'label' | 'line';
export type TextSize = 'xs' | 'sm' | 'base' | 'lg';
export type TextRotation = 0 | 90 | -90;
export type LineColor = 'dark' | 'blue' | 'muted' | 'gold' | 'red';
export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type BorderStyle = 'solid' | 'dashed' | 'none';
export type LineAxis = 'h' | 'v' | 'diag-down' | 'diag-up';

export interface LinePoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FloorplanFloor {
  id: string;
  name: string;
}

export interface FloorplanBox {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  sublabel?: string;
  fontSize?: TextSize;
  rotate?: TextRotation;
  align?: 'left' | 'center';
  border?: BorderStyle;
  z?: number;
  floor?: string;
}

export interface FloorplanDoor {
  id: string;
  edge: DoorEdge;
  offset: number;
  floor?: string;
}

export interface FloorplanShape {
  id: string;
  kind: ShapeKind;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  border?: BorderStyle;
  lineColor?: LineColor;
  lineAxis?: LineAxis;
  linePoints?: LinePoints;
  lineWidth?: number;
  lineStyle?: LineStyle;
  fontSize?: TextSize;
  rotate?: TextRotation;
  align?: 'left' | 'center';
  z?: number;
  floor?: string;
}

export interface FloorplanData {
  boxes: Record<string, FloorplanBox>;
  doors: FloorplanDoor[];
  shapes?: FloorplanShape[];
  height?: number;
  floors?: FloorplanFloor[];
}

export const FLOORPLAN_COLORS = [
  { id: 0, name: 'Gold', className: 'bg-gold/15 border-gold/50 text-foreground' },
  { id: 1, name: 'Green', className: 'bg-emerald-500/15 border-emerald-500/40 text-foreground' },
  { id: 2, name: 'Violet', className: 'bg-violet-500/15 border-violet-500/40 text-foreground' },
  { id: 3, name: 'Amber', className: 'bg-amber-500/15 border-amber-500/40 text-foreground' },
  { id: 4, name: 'White', className: 'bg-background border-foreground/75 text-foreground' },
  { id: 5, name: 'Slate', className: 'bg-muted/60 border-foreground/45 text-foreground' },
  { id: 6, name: 'Blue', className: 'bg-sky-500/15 border-sky-500/50 text-foreground' },
] as const;

export const FLOORPLAN_HEIGHT_PRESETS = [
  { label: 'Compact (460px)', value: 460 },
  { label: 'Default (520px)', value: 520 },
  { label: 'Standard (600px)', value: 600 },
  { label: 'Tall (840px)', value: 840 },
  { label: 'Extra Tall (1100px)', value: 1100 },
] as const;

export const INITIAL_FLOORPLAN: FloorplanData = {
  boxes: {},
  doors: [{ id: 'entrance', edge: 'bottom', offset: 50 }],
  shapes: [],
  height: 520,
};

export const LINE_THICKNESS_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10] as const;

export const LINE_STYLE_OPTIONS: Array<{ value: LineStyle; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Broken (Dashed)' },
  { value: 'dotted', label: 'Dotted' },
];

export const LINE_COLOR_OPTIONS: Array<{ value: LineColor; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'blue', label: 'Blue' },
  { value: 'muted', label: 'Muted' },
  { value: 'gold', label: 'Amber' },
  { value: 'red', label: 'Red' },
];

export const clampPct = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const snapPct = (value: number, step: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (!step || step <= 0) return Math.round(value * 10) / 10;
  return Math.round(value / step) * step;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

const VALID_FONT_SIZES: TextSize[] = ['xs', 'sm', 'base', 'lg'];
const VALID_ROTATIONS: TextRotation[] = [0, 90, -90];
const VALID_BORDERS: BorderStyle[] = ['solid', 'dashed', 'none'];
const VALID_LINE_COLORS: LineColor[] = ['dark', 'blue', 'muted', 'gold', 'red'];
const VALID_LINE_STYLES: LineStyle[] = ['solid', 'dashed', 'dotted'];
const VALID_LINE_AXES: LineAxis[] = ['h', 'v', 'diag-down', 'diag-up'];

function validLinePoints(value: unknown): value is LinePoints {
  if (!value || typeof value !== 'object') return false;
  const p = value as LinePoints;
  if (![p.x1, p.y1, p.x2, p.y2].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100.01)) {
    return false;
  }
  return Math.hypot(p.x2 - p.x1, p.y2 - p.y1) >= 0.4;
}

function validBounds(b: { x: number; y: number; w: number; h: number }, minW: number, minH: number): boolean {
  return (
    [b.x, b.y, b.w, b.h].every(Number.isFinite) &&
    b.x >= 0 &&
    b.y >= 0 &&
    b.w >= minW &&
    b.h >= minH &&
    b.x + b.w <= 100.01 &&
    b.y + b.h <= 100.01
  );
}

function validFloorId(val: unknown): boolean {
  return val === undefined || (typeof val === 'string' && val.trim().length > 0 && val.length <= 64);
}

function validOptionalBoxProps(b: Partial<FloorplanBox>): boolean {
  if (b.sublabel !== undefined && typeof b.sublabel !== 'string') return false;
  if (b.fontSize !== undefined && !VALID_FONT_SIZES.includes(b.fontSize)) return false;
  if (b.rotate !== undefined && !VALID_ROTATIONS.includes(b.rotate)) return false;
  if (b.align !== undefined && b.align !== 'left' && b.align !== 'center') return false;
  if (b.border !== undefined && !VALID_BORDERS.includes(b.border)) return false;
  if (b.z !== undefined && !Number.isFinite(b.z)) return false;
  if (!validFloorId(b.floor)) return false;
  return true;
}

export function validFloorplan(value: unknown): value is FloorplanData {
  if (!value || typeof value !== 'object') return false;
  const p = value as FloorplanData;
  if (!p.boxes || typeof p.boxes !== 'object' || Array.isArray(p.boxes) || !Array.isArray(p.doors)) {
    return false;
  }
  const boxesValid = Object.values(p.boxes).every(
    b =>
      !!b &&
      validBounds(b, 2, 2) &&
      Number.isInteger(b.color) &&
      b.color >= 0 &&
      b.color < FLOORPLAN_COLORS.length &&
      validOptionalBoxProps(b),
  );
  if (!boxesValid) return false;

  const doorsValid = p.doors.every(
    d =>
      !!d &&
      typeof d.id === 'string' &&
      ['top', 'bottom', 'left', 'right'].includes(d.edge) &&
      Number.isFinite(d.offset) &&
      d.offset >= 2 &&
      d.offset <= 98 &&
      validFloorId(d.floor),
  );
  if (!doorsValid) return false;

  if (p.floors !== undefined) {
    if (!Array.isArray(p.floors)) return false;
    const seenIds = new Set<string>();
    const floorsValid = p.floors.every(f => {
      if (!f || typeof f !== 'object') return false;
      if (typeof f.id !== 'string' || !f.id.trim() || f.id.length > 64) return false;
      if (typeof f.name !== 'string' || !f.name.trim() || f.name.length > 60) return false;
      if (seenIds.has(f.id)) return false;
      seenIds.add(f.id);
      return true;
    });
    if (!floorsValid) return false;
  }

  if (p.shapes !== undefined) {
    if (!Array.isArray(p.shapes)) return false;
    const shapesValid = p.shapes.every(s => {
      if (!s || typeof s.id !== 'string' || typeof s.label !== 'string') return false;
      if (!['box', 'label', 'line'].includes(s.kind)) return false;
      const minW = s.kind === 'line' ? 0.5 : 2;
      const minH = s.kind === 'line' ? 0.5 : 2;
      if (!validBounds(s, minW, minH)) return false;
      if (!Number.isInteger(s.color) || s.color < 0 || s.color >= FLOORPLAN_COLORS.length) return false;
      if (s.lineColor !== undefined && !VALID_LINE_COLORS.includes(s.lineColor)) return false;
      if (s.lineAxis !== undefined && !VALID_LINE_AXES.includes(s.lineAxis)) return false;
      if (s.lineStyle !== undefined && !VALID_LINE_STYLES.includes(s.lineStyle)) return false;
      if (
        s.lineWidth !== undefined &&
        (typeof s.lineWidth !== 'number' || !Number.isFinite(s.lineWidth) || s.lineWidth < 1 || s.lineWidth > 12)
      ) {
        return false;
      }
      if (s.linePoints !== undefined && (s.kind !== 'line' || !validLinePoints(s.linePoints))) return false;
      return validOptionalBoxProps(s);
    });
    if (!shapesValid) return false;
  }

  if (p.height !== undefined && (!Number.isFinite(p.height) || p.height < 300 || p.height > 1600)) {
    return false;
  }

  return true;
}

export function normalizeRectFromPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  snapStep = 0,
  minSize = 2,
): { x: number; y: number; w: number; h: number } {
  const sx1 = clampPct(snapPct(x1, snapStep), 0, 100);
  const sy1 = clampPct(snapPct(y1, snapStep), 0, 100);
  const sx2 = clampPct(snapPct(x2, snapStep), 0, 100);
  const sy2 = clampPct(snapPct(y2, snapStep), 0, 100);
  const rawX = Math.min(sx1, sx2);
  const rawY = Math.min(sy1, sy2);
  const w = Math.max(minSize, Math.min(100 - rawX, Math.abs(sx2 - sx1)));
  const h = Math.max(minSize, Math.min(100 - rawY, Math.abs(sy2 - sy1)));
  return {
    x: clampPct(rawX, 0, 100 - w),
    y: clampPct(rawY, 0, 100 - h),
    w: Math.round(w * 10) / 10,
    h: Math.round(h * 10) / 10,
  };
}

export function getLineEndpoints(
  s: Pick<FloorplanShape, 'x' | 'y' | 'w' | 'h' | 'lineAxis' | 'linePoints'>,
): LinePoints {
  if (s.linePoints) {
    return {
      x1: r1(clampPct(s.linePoints.x1, 0, 100)),
      y1: r1(clampPct(s.linePoints.y1, 0, 100)),
      x2: r1(clampPct(s.linePoints.x2, 0, 100)),
      y2: r1(clampPct(s.linePoints.y2, 0, 100)),
    };
  }
  switch (s.lineAxis) {
    case 'v':
      return { x1: r1(s.x + s.w / 2), y1: s.y, x2: r1(s.x + s.w / 2), y2: r1(s.y + s.h) };
    case 'diag-down':
      return { x1: s.x, y1: s.y, x2: r1(s.x + s.w), y2: r1(s.y + s.h) };
    case 'diag-up':
      return { x1: s.x, y1: r1(s.y + s.h), x2: r1(s.x + s.w), y2: s.y };
    case 'h':
    default:
      return { x1: s.x, y1: r1(s.y + s.h / 2), x2: r1(s.x + s.w), y2: r1(s.y + s.h / 2) };
  }
}

export function inferLineAxis(p: LinePoints): LineAxis {
  const dx = p.x2 - p.x1;
  const dy = p.y2 - p.y1;
  if (Math.abs(dy) < 0.05) return 'h';
  if (Math.abs(dx) < 0.05) return 'v';
  return dx * dy >= 0 ? 'diag-down' : 'diag-up';
}

export function shapeGeometryFromLinePoints(
  p: LinePoints,
): Pick<FloorplanShape, 'x' | 'y' | 'w' | 'h' | 'lineAxis' | 'linePoints'> {
  const x1 = r1(clampPct(p.x1, 0, 100));
  const y1 = r1(clampPct(p.y1, 0, 100));
  let x2 = r1(clampPct(p.x2, 0, 100));
  let y2 = r1(clampPct(p.y2, 0, 100));

  if (Math.hypot(x2 - x1, y2 - y1) < 0.5) {
    x2 = x1 <= 99 ? r1(x1 + 0.5) : r1(x1 - 0.5);
  }

  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const spanX = r1(maxX - minX);
  const spanY = r1(maxY - minY);
  const w = spanX >= 1 ? spanX : 1;
  const h = spanY >= 1 ? spanY : 1;
  const x = spanX >= 1 ? minX : r1(clampPct((minX + maxX) / 2 - 0.5, 0, 100 - w));
  const y = spanY >= 1 ? minY : r1(clampPct((minY + maxY) / 2 - 0.5, 0, 100 - h));
  const linePoints = { x1, y1, x2, y2 };

  return {
    x,
    y,
    w: r1(clampPct(w, 0.5, 100 - x)),
    h: r1(clampPct(h, 0.5, 100 - y)),
    lineAxis: inferLineAxis(linePoints),
    linePoints,
  };
}

export function snapLineEndpointAngle(
  ax: number,
  ay: number,
  rawX: number,
  rawY: number,
  snapStep = 0,
): { x: number; y: number } {
  const dx = rawX - ax;
  const dy = rawY - ay;
  if (Math.hypot(dx, dy) < 1e-4) return { x: r1(clampPct(rawX, 0, 100)), y: r1(clampPct(rawY, 0, 100)) };
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const normOct = ((octant % 8) + 8) % 8;

  if (normOct === 0 || normOct === 4) {
    const snappedX = snapStep > 0 ? snapPct(rawX, snapStep) : rawX;
    return { x: r1(clampPct(snappedX, 0, 100)), y: r1(ay) };
  }
  if (normOct === 2 || normOct === 6) {
    const snappedY = snapStep > 0 ? snapPct(rawY, snapStep) : rawY;
    return { x: r1(ax), y: r1(clampPct(snappedY, 0, 100)) };
  }

  const ux = dx >= 0 ? 1 : -1;
  const uy = dy >= 0 ? 1 : -1;
  const maxX = ux > 0 ? 100 - ax : ax;
  const maxY = uy > 0 ? 100 - ay : ay;
  const rawD = (Math.abs(dx) + Math.abs(dy)) / 2;
  const snappedD = snapStep > 0 ? snapPct(rawD, snapStep) : rawD;
  const d = Math.min(snappedD, maxX, maxY);
  return { x: r1(clampPct(ax + ux * d, 0, 100)), y: r1(clampPct(ay + uy * d, 0, 100)) };
}

export function updateLineEndpoint(
  pts: LinePoints,
  which: 'p1' | 'p2',
  rawX: number,
  rawY: number,
  snapStep = 0,
  lockAngle = false,
): LinePoints {
  const anchorX = which === 'p1' ? pts.x2 : pts.x1;
  const anchorY = which === 'p1' ? pts.y2 : pts.y1;
  let nx = clampPct(snapStep > 0 ? snapPct(rawX, snapStep) : rawX, 0, 100);
  let ny = clampPct(snapStep > 0 ? snapPct(rawY, snapStep) : rawY, 0, 100);

  if (lockAngle) {
    const locked = snapLineEndpointAngle(anchorX, anchorY, rawX, rawY, snapStep);
    nx = locked.x;
    ny = locked.y;
  }

  if (Math.hypot(nx - anchorX, ny - anchorY) < 0.5) {
    const prevX = which === 'p1' ? pts.x1 : pts.x2;
    const prevY = which === 'p1' ? pts.y1 : pts.y2;
    let vx = prevX - anchorX;
    let vy = prevY - anchorY;
    const vLen = Math.hypot(vx, vy);
    if (vLen < 1e-4) {
      vx = anchorX <= 99 ? 1 : -1;
      vy = 0;
    } else {
      vx /= vLen;
      vy /= vLen;
    }
    const cx = anchorX + vx * 0.5;
    const cy = anchorY + vy * 0.5;
    nx = clampPct(cx >= 0 && cx <= 100 ? cx : anchorX - vx * 0.5, 0, 100);
    ny = clampPct(cy >= 0 && cy <= 100 ? cy : anchorY - vy * 0.5, 0, 100);
  }

  return which === 'p1'
    ? { x1: r1(nx), y1: r1(ny), x2: r1(anchorX), y2: r1(anchorY) }
    : { x1: r1(anchorX), y1: r1(anchorY), x2: r1(nx), y2: r1(ny) };
}

export function moveLinePoints(
  pts: LinePoints,
  dx: number,
  dy: number,
  snapStep = 0,
  snapToGrid = true,
): LinePoints {
  const minX = Math.min(pts.x1, pts.x2);
  const maxX = Math.max(pts.x1, pts.x2);
  const minY = Math.min(pts.y1, pts.y2);
  const maxY = Math.max(pts.y1, pts.y2);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const appliedDx =
    snapToGrid && snapStep > 0
      ? clampPct(snapPct(minX + dx, snapStep), 0, 100 - spanX) - minX
      : clampPct(dx, -minX, 100 - maxX);
  const appliedDy =
    snapToGrid && snapStep > 0
      ? clampPct(snapPct(minY + dy, snapStep), 0, 100 - spanY) - minY
      : clampPct(dy, -minY, 100 - maxY);

  return {
    x1: r1(clampPct(pts.x1 + appliedDx, 0, 100)),
    y1: r1(clampPct(pts.y1 + appliedDy, 0, 100)),
    x2: r1(clampPct(pts.x2 + appliedDx, 0, 100)),
    y2: r1(clampPct(pts.y2 + appliedDy, 0, 100)),
  };
}

export function createDrawnLineGeometry(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  snapStep = 0,
  lockAngle = false,
): Pick<FloorplanShape, 'x' | 'y' | 'w' | 'h' | 'lineAxis' | 'linePoints'> {
  const sx1 = clampPct(snapPct(x1, snapStep), 0, 100);
  const sy1 = clampPct(snapPct(y1, snapStep), 0, 100);
  if (Math.abs(x2 - x1) < 1.5 && Math.abs(y2 - y1) < 1.5) {
    const endX = r1(clampPct(sx1 + 16, 0, 100));
    const startX = endX - sx1 >= 2 ? r1(sx1) : r1(clampPct(endX - 16, 0, 100));
    return shapeGeometryFromLinePoints({ x1: startX, y1: r1(sy1), x2: endX, y2: r1(sy1) });
  }
  const pts = updateLineEndpoint({ x1: sx1, y1: sy1, x2: sx1 + 1, y2: sy1 }, 'p2', x2, y2, snapStep, lockAngle);
  return shapeGeometryFromLinePoints(pts);
}

export function getLineMetrics(pts: LinePoints): { length: number; angleDeg: number } {
  const dx = pts.x2 - pts.x1;
  const dy = pts.y2 - pts.y1;
  return {
    length: r1(Math.hypot(dx, dy)),
    angleDeg: r1((Math.atan2(dy, dx) * 180) / Math.PI),
  };
}

function projectLineFromVector(pts: LinePoints, ux: number, uy: number, targetLen: number): LinePoints {
  const cleanUx = Math.abs(ux) < 1e-10 ? 0 : ux;
  const cleanUy = Math.abs(uy) < 1e-10 ? 0 : uy;
  const txMax = cleanUx > 1e-9 ? (100 - pts.x1) / cleanUx : cleanUx < -1e-9 ? pts.x1 / -cleanUx : Number.POSITIVE_INFINITY;
  const tyMax = cleanUy > 1e-9 ? (100 - pts.y1) / cleanUy : cleanUy < -1e-9 ? pts.y1 / -cleanUy : Number.POSITIVE_INFINITY;
  const maxAllowed = Math.min(txMax, tyMax);

  let x1 = pts.x1;
  let y1 = pts.y1;
  let len = Math.max(0.5, targetLen);
  if (maxAllowed < 0.5) {
    const shift = 0.5 - maxAllowed;
    x1 = clampPct(x1 - cleanUx * shift, 0, 100);
    y1 = clampPct(y1 - cleanUy * shift, 0, 100);
    len = 0.5;
  } else {
    len = clampPct(len, 0.5, maxAllowed);
  }

  return {
    x1: r1(x1),
    y1: r1(y1),
    x2: r1(clampPct(x1 + cleanUx * len, 0, 100)),
    y2: r1(clampPct(y1 + cleanUy * len, 0, 100)),
  };
}

export function resizeLineLength(pts: LinePoints, nextLength: number): LinePoints {
  if (!Number.isFinite(nextLength)) return pts;
  const dx = pts.x2 - pts.x1;
  const dy = pts.y2 - pts.y1;
  const currentLen = Math.hypot(dx, dy);
  const ux = currentLen > 1e-4 ? dx / currentLen : 1;
  const uy = currentLen > 1e-4 ? dy / currentLen : 0;
  return projectLineFromVector(pts, ux, uy, nextLength);
}

export function rotateLineAngle(pts: LinePoints, nextAngleDeg: number): LinePoints {
  if (!Number.isFinite(nextAngleDeg)) return pts;
  const currentLen = Math.max(0.5, Math.hypot(pts.x2 - pts.x1, pts.y2 - pts.y1));
  const rad = (nextAngleDeg * Math.PI) / 180;
  return projectLineFromVector(pts, Math.cos(rad), Math.sin(rad), currentLen);
}

export function straightenLine(pts: LinePoints, mode: 'h' | 'v' | 'swap'): LinePoints {
  if (mode === 'swap') {
    return { x1: pts.x2, y1: pts.y2, x2: pts.x1, y2: pts.y1 };
  }
  const len = Math.max(2, Math.hypot(pts.x2 - pts.x1, pts.y2 - pts.y1));
  if (mode === 'h') {
    if (Math.abs(pts.x2 - pts.x1) >= 1) {
      return { x1: r1(pts.x1), y1: r1(pts.y1), x2: r1(pts.x2), y2: r1(pts.y1) };
    }
    const ux = pts.x1 + len <= 100 ? 1 : pts.x1 - len >= 0 ? -1 : pts.x1 <= 50 ? 1 : -1;
    return projectLineFromVector(pts, ux, 0, len);
  }
  if (Math.abs(pts.y2 - pts.y1) >= 1) {
    return { x1: r1(pts.x1), y1: r1(pts.y1), x2: r1(pts.x1), y2: r1(pts.y2) };
  }
  const uy = pts.y1 + len <= 100 ? 1 : pts.y1 - len >= 0 ? -1 : pts.y1 <= 50 ? 1 : -1;
  return projectLineFromVector(pts, 0, uy, len);
}

export function resolveLineWidth(width: number | undefined, compact = false): number {
  const base = typeof width === 'number' && Number.isFinite(width) ? clampPct(width, 1, 12) : 2;
  return compact ? Math.max(1, r1(base * 0.65)) : base;
}

export function resolveLineDash(
  style: LineStyle | undefined,
  width: number,
): { strokeDasharray?: string; strokeLinecap: 'butt' | 'round' } {
  switch (style) {
    case 'dashed': {
      const dash = Math.round(Math.max(7, width * 3));
      const gap = Math.round(Math.max(4, width * 1.8));
      return { strokeDasharray: `${dash} ${gap}`, strokeLinecap: 'butt' };
    }
    case 'dotted': {
      const gap = Math.round(Math.max(5, width * 2.4));
      return { strokeDasharray: `0.1 ${gap}`, strokeLinecap: 'round' };
    }
    case 'solid':
    default:
      return { strokeDasharray: undefined, strokeLinecap: 'butt' };
  }
}

export function duplicateShape(shape: FloorplanShape, newId: string): FloorplanShape {
  const offset = 3;
  const x = clampPct(shape.x + offset, 0, 100 - shape.w);
  const y = clampPct(shape.y + offset, 0, 100 - shape.h);
  if (shape.kind === 'line') {
    const pts = getLineEndpoints(shape);
    const dx = x - shape.x;
    const dy = y - shape.y;
    return {
      ...shape,
      id: newId,
      ...shapeGeometryFromLinePoints({
        x1: pts.x1 + dx,
        y1: pts.y1 + dy,
        x2: pts.x2 + dx,
        y2: pts.y2 + dy,
      }),
    };
  }
  return {
    ...shape,
    id: newId,
    x: r1(x),
    y: r1(y),
  };
}

export function fontSizeClass(size: TextSize | undefined, compact: boolean): string {
  if (compact) return 'text-[9px] leading-tight';
  switch (size) {
    case 'xs':
      return 'text-[10px] leading-tight';
    case 'base':
      return 'text-sm leading-snug';
    case 'lg':
      return 'text-base leading-snug';
    case 'sm':
    default:
      return 'text-xs leading-tight';
  }
}

export function resolveEffectiveFloorId(itemFloor: string | undefined, floors?: FloorplanFloor[]): string {
  if (!floors || floors.length === 0) return 'default';
  if (itemFloor && floors.some(f => f.id === itemFloor)) return itemFloor;
  return floors[0].id;
}

export function belongsToFloor(
  itemFloor: string | undefined,
  activeFloorId: string,
  floors?: FloorplanFloor[],
): boolean {
  if (!floors || floors.length <= 1) return true;
  return resolveEffectiveFloorId(itemFloor, floors) === activeFloorId;
}

export function boxPropsFromShape(shape: FloorplanShape): FloorplanBox {
  return {
    x: shape.x,
    y: shape.y,
    w: shape.w,
    h: shape.h,
    color: shape.color,
    fontSize: shape.fontSize ?? 'sm',
    rotate: shape.rotate ?? 0,
    align: shape.align ?? 'center',
    border: shape.border ?? 'solid',
    z: shape.z ?? 20,
    ...(shape.floor ? { floor: shape.floor } : {}),
  };
}

export function suggestZoneNameFromShape(label: string, existingNames: string[]): string {
  const cleaned = label.replace(/\s*\n+\s*/g, ' / ').replace(/\s+/g, ' ').trim();
  const base = (cleaned || 'New Zone').slice(0, 60);
  const taken = new Set(existingNames.map(n => n.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let counter = 2;
  while (counter < 1000) {
    const suffix = ` ${counter}`;
    const candidate = `${base.slice(0, 60 - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    counter += 1;
  }
  return base;
}

export interface FloorplanBoundsItem {
  kind: 'zone' | 'shape';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AlignMode = 'left' | 'center-h' | 'right' | 'top' | 'middle-v' | 'bottom';
export type DistributeAxis = 'h' | 'v';
export type MatchSizeMode = 'w' | 'h';

export function itemSelectionKey(kind: 'zone' | 'shape', id: string): string {
  return `${kind}:${id}`;
}

export function rectIntersects(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function clampGroupDelta(
  items: Array<Pick<FloorplanBoundsItem, 'x' | 'y' | 'w' | 'h'>>,
  dx: number,
  dy: number,
  snapStep = 0,
  snapToGrid = true,
): { dx: number; dy: number } {
  if (!items.length) return { dx: 0, dy: 0 };
  const minX = Math.min(...items.map(i => i.x));
  const maxRight = Math.max(...items.map(i => i.x + i.w));
  const minY = Math.min(...items.map(i => i.y));
  const maxBottom = Math.max(...items.map(i => i.y + i.h));
  const spanX = maxRight - minX;
  const spanY = maxBottom - minY;

  const appliedDx =
    snapToGrid && snapStep > 0
      ? clampPct(snapPct(minX + dx, snapStep), 0, 100 - spanX) - minX
      : clampPct(dx, -minX, 100 - maxRight);
  const appliedDy =
    snapToGrid && snapStep > 0
      ? clampPct(snapPct(minY + dy, snapStep), 0, 100 - spanY) - minY
      : clampPct(dy, -minY, 100 - maxBottom);

  return { dx: r1(appliedDx), dy: r1(appliedDy) };
}

export function computeAlignDeltas(
  items: FloorplanBoundsItem[],
  mode: AlignMode,
): Record<string, { dx: number; dy: number }> {
  if (items.length < 2) return {};
  const minX = Math.min(...items.map(i => i.x));
  const maxX = Math.max(...items.map(i => i.x + i.w));
  const midX = (minX + maxX) / 2;
  const minY = Math.min(...items.map(i => i.y));
  const maxY = Math.max(...items.map(i => i.y + i.h));
  const midY = (minY + maxY) / 2;

  const out: Record<string, { dx: number; dy: number }> = {};
  for (const item of items) {
    let rawDx = 0;
    let rawDy = 0;
    switch (mode) {
      case 'left':
        rawDx = minX - item.x;
        break;
      case 'center-h':
        rawDx = midX - (item.x + item.w / 2);
        break;
      case 'right':
        rawDx = maxX - (item.x + item.w);
        break;
      case 'top':
        rawDy = minY - item.y;
        break;
      case 'middle-v':
        rawDy = midY - (item.y + item.h / 2);
        break;
      case 'bottom':
        rawDy = maxY - (item.y + item.h);
        break;
    }
    const clampedX = clampPct(item.x + rawDx, 0, 100 - item.w);
    const clampedY = clampPct(item.y + rawDy, 0, 100 - item.h);
    out[itemSelectionKey(item.kind, item.id)] = {
      dx: r1(clampedX - item.x),
      dy: r1(clampedY - item.y),
    };
  }
  return out;
}

export function computeDistributeDeltas(
  items: FloorplanBoundsItem[],
  axis: DistributeAxis,
): Record<string, { dx: number; dy: number }> {
  if (items.length < 3) return {};
  const sorted = [...items].sort((a, b) =>
    axis === 'h' ? a.x + a.w / 2 - (b.x + b.w / 2) : a.y + a.h / 2 - (b.y + b.h / 2),
  );
  const out: Record<string, { dx: number; dy: number }> = {};

  if (axis === 'h') {
    const start = sorted[0].x;
    const end = sorted[sorted.length - 1].x + sorted[sorted.length - 1].w;
    const totalW = sorted.reduce((s, item) => s + item.w, 0);
    if (end - start >= totalW) {
      const gap = (end - start - totalW) / (sorted.length - 1);
      let cursor = start;
      for (const item of sorted) {
        const nextX = clampPct(cursor, 0, 100 - item.w);
        out[itemSelectionKey(item.kind, item.id)] = { dx: r1(nextX - item.x), dy: 0 };
        cursor += item.w + gap;
      }
    } else {
      const firstC = sorted[0].x + sorted[0].w / 2;
      const lastC = sorted[sorted.length - 1].x + sorted[sorted.length - 1].w / 2;
      const step = (lastC - firstC) / (sorted.length - 1);
      sorted.forEach((item, idx) => {
        const targetX = clampPct(firstC + step * idx - item.w / 2, 0, 100 - item.w);
        out[itemSelectionKey(item.kind, item.id)] = { dx: r1(targetX - item.x), dy: 0 };
      });
    }
    return out;
  }

  const start = sorted[0].y;
  const end = sorted[sorted.length - 1].y + sorted[sorted.length - 1].h;
  const totalH = sorted.reduce((s, item) => s + item.h, 0);
  if (end - start >= totalH) {
    const gap = (end - start - totalH) / (sorted.length - 1);
    let cursor = start;
    for (const item of sorted) {
      const nextY = clampPct(cursor, 0, 100 - item.h);
      out[itemSelectionKey(item.kind, item.id)] = { dx: 0, dy: r1(nextY - item.y) };
      cursor += item.h + gap;
    }
  } else {
    const firstC = sorted[0].y + sorted[0].h / 2;
    const lastC = sorted[sorted.length - 1].y + sorted[sorted.length - 1].h / 2;
    const step = (lastC - firstC) / (sorted.length - 1);
    sorted.forEach((item, idx) => {
      const targetY = clampPct(firstC + step * idx - item.h / 2, 0, 100 - item.h);
      out[itemSelectionKey(item.kind, item.id)] = { dx: 0, dy: r1(targetY - item.y) };
    });
  }
  return out;
}

export function computeMatchSizes(
  items: FloorplanBoundsItem[],
  referenceItem: FloorplanBoundsItem,
  mode: MatchSizeMode,
): Record<string, { w?: number; h?: number }> {
  if (items.length < 2) return {};
  const out: Record<string, { w?: number; h?: number }> = {};
  for (const item of items) {
    if (mode === 'w') {
      const w = r1(clampPct(referenceItem.w, 2, 100 - item.x));
      out[itemSelectionKey(item.kind, item.id)] = { w };
    } else {
      const h = r1(clampPct(referenceItem.h, 2, 100 - item.y));
      out[itemSelectionKey(item.kind, item.id)] = { h };
    }
  }
  return out;
}

export type CopiedFloorplanStyle =
  | {
      styleKind: 'rect';
      color: number;
      border: BorderStyle;
      fontSize: TextSize;
      rotate: TextRotation;
      align: 'left' | 'center';
    }
  | {
      styleKind: 'line';
      lineColor: LineColor;
      lineStyle: LineStyle;
      lineWidth: number;
    };

export function extractBoxStyle(box: FloorplanBox | FloorplanShape): CopiedFloorplanStyle {
  if ('kind' in box && box.kind === 'line') {
    return {
      styleKind: 'line',
      lineColor: box.lineColor ?? 'dark',
      lineStyle: box.lineStyle ?? 'solid',
      lineWidth: resolveLineWidth(box.lineWidth),
    };
  }
  return {
    styleKind: 'rect',
    color: box.color,
    border: box.border ?? ('kind' in box && box.kind === 'label' ? 'none' : 'solid'),
    fontSize: box.fontSize ?? 'sm',
    rotate: box.rotate ?? 0,
    align: box.align ?? ('kind' in box ? 'center' : 'left'),
  };
}

export function parseFloorplanImport(rawJson: string): FloorplanData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  const candidate =
    parsed && typeof parsed === 'object' && 'layout' in parsed && !('boxes' in parsed)
      ? (parsed as { layout: unknown }).layout
      : parsed;
  if (!validFloorplan(candidate)) {
    throw new Error('The JSON file does not match the warehouse floorplan format.');
  }
  return candidate;
}

