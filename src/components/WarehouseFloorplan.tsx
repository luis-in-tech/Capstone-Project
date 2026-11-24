import { memo, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  ArrowClockwiseIcon as Redo2,
  ArrowCounterClockwiseIcon as Undo2,
  ArrowDownIcon as ArrowDown,
  ArrowLineDownIcon as ArrowToBottom,
  ArrowLineUpIcon as ArrowToTop,
  ArrowUpIcon as ArrowUp,
  CopyIcon as Copy,
  CursorIcon as MousePointer,
  DoorOpenIcon as DoorOpen,
  DownloadIcon as Download,
  EraserIcon as Eraser,
  EyeIcon as Eye,
  EyeSlashIcon as EyeOff,
  FloppyDiskIcon as Save,
  GridFourIcon as Grid,
  ImageIcon as ImageIcon,
  MinusIcon as Minus,
  PackageIcon as Package,
  PencilIcon as Pencil,
  PlusIcon as Plus,
  SquareIcon as Square,
  StackIcon as LayersIcon,
  TextBIcon as BoldIcon,
  TextItalicIcon as ItalicIcon,
  TextTIcon as TextT,
  TextUnderlineIcon as UnderlineIcon,
  TrashIcon as Trash2,
  UploadSimpleIcon as Upload,
  XIcon as X,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import { defaultZoneBox, type WarehouseZone } from '../lib/warehouseLayout';
import { FloorplanColorPicker } from './FloorplanColorPicker';
import {
  FLOORPLAN_COLORS,
  FLOORPLAN_HEIGHT_PRESETS,
  INITIAL_FLOORPLAN,
  LINE_COLOR_OPTIONS,
  LINE_STYLE_OPTIONS,
  LINE_THICKNESS_OPTIONS,
  belongsToFloor,
  clampGroupDelta,
  clampPct,
  computeAlignDeltas,
  computeContrastBorderHex,
  computeDistributeDeltas,
  computeMatchSizes,
  computeReorderedZIndices,
  computeRotatedRect90,
  createDrawnLineGeometry,
  duplicateShape,
  extractBoxStyle,
  fontSizeClass,
  getLineEndpoints,
  getLineMetrics,
  hexToRgba,
  isDarkHexColor,
  itemSelectionKey,
  moveLinePoints,
  normalizeRectFromPoints,
  parseFloorplanImport,
  readCachedFloorplanMeta,
  rectIntersects,
  resizeLineLength,
  resolveEffectiveFloorId,
  resolveLineDash,
  resolveLineWidth,
  rotateLineAngle,
  shapeGeometryFromLinePoints,
  snapPct,
  straightenLine,
  updateLineEndpoint,
  validFloorplan,
  writeCachedFloorplanMeta,
  type AlignMode,
  type BorderStyle,
  type CopiedFloorplanStyle,
  type DistributeAxis,
  type DoorEdge,
  type FloorplanBoundsItem,
  type FloorplanBox,
  type FloorplanData,
  type FloorplanDoor,
  type FloorplanShape,
  type LayerAction,
  type LayerOrderedItem,
  type LineColor,
  type LinePoints,
  type LineStyle,
  type MatchSizeMode,
  type TextRotation,
  type TextSize,
} from '../lib/warehouseFloorplan';

type ToolMode = 'select' | 'draw-box' | 'draw-line';
type ChosenTarget = { kind: 'zone' | 'shape' | 'door'; id: string } | null;
type SelectedRef = { kind: 'zone' | 'shape'; id: string };

export interface PendingZoneConversion {
  seq: number;
  sourceShapeId: string;
  zoneId: string;
  box: FloorplanBox;
}

type FloorplanHistoryDoc = {
  plan: FloorplanData;
  undo: FloorplanData[];
  redo: FloorplanData[];
};

type GroupOriginItem = FloorplanBoundsItem & {
  linePoints?: LinePoints;
};

type DragSession = {
  pointerId: number;
  targetKind: 'zone' | 'shape' | 'door' | 'group';
  id: string;
  mode: string;
  startClientX: number;
  startClientY: number;
  origBounds?: { x: number; y: number; w: number; h: number };
  origLinePoints?: LinePoints;
  origDoor?: FloorplanDoor;
  groupOrigins?: GroupOriginItem[];
  basePlan: FloorplanData;
  moved: boolean;
};

type DrawSession = {
  pointerId: number;
  kind: 'box' | 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  shiftKey?: boolean;
};

type MarqueeSession = {
  pointerId: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  additive: boolean;
};

const MAX_HISTORY = 50;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const EMPTY_FLOORS: NonNullable<FloorplanData['floors']> = [];
const EMPTY_SHAPES: FloorplanShape[] = [];

const r1 = (n: number) => Math.round(n * 10) / 10;

function shallowEqualDefined(a: Record<string, any> | undefined, b: Record<string, any> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const k of Object.keys(a)) {
    if (a[k] !== undefined && a[k] !== b[k]) return false;
  }
  for (const k of Object.keys(b)) {
    if (b[k] !== undefined && a[k] !== b[k]) return false;
  }
  return true;
}

function shapesEqual(a: FloorplanShape, b: FloorplanShape): boolean {
  if (a === b) return true;
  for (const k of Object.keys(a) as Array<keyof FloorplanShape>) {
    if (k === 'linePoints') continue;
    if (a[k] !== undefined && a[k] !== b[k]) return false;
  }
  for (const k of Object.keys(b) as Array<keyof FloorplanShape>) {
    if (k === 'linePoints') continue;
    if (b[k] !== undefined && a[k] !== b[k]) return false;
  }
  return shallowEqualDefined(a.linePoints, b.linePoints);
}

function areFloorplansEqual(a: FloorplanData, b: FloorplanData): boolean {
  if (a === b) return true;
  if (a.height !== b.height) return false;

  const floorsA = a.floors ?? EMPTY_FLOORS;
  const floorsB = b.floors ?? EMPTY_FLOORS;
  if (floorsA !== floorsB) {
    if (floorsA.length !== floorsB.length) return false;
    for (let i = 0; i < floorsA.length; i++) {
      if (floorsA[i].id !== floorsB[i].id || floorsA[i].name !== floorsB[i].name) return false;
    }
  }

  if (a.doors !== b.doors) {
    if (a.doors.length !== b.doors.length) return false;
    for (let i = 0; i < a.doors.length; i++) {
      if (!shallowEqualDefined(a.doors[i], b.doors[i])) return false;
    }
  }

  const shapesA = a.shapes ?? EMPTY_SHAPES;
  const shapesB = b.shapes ?? EMPTY_SHAPES;
  if (shapesA !== shapesB) {
    if (shapesA.length !== shapesB.length) return false;
    for (let i = 0; i < shapesA.length; i++) {
      if (!shapesEqual(shapesA[i], shapesB[i])) return false;
    }
  }

  if (a.boxes !== b.boxes) {
    const keysA = Object.keys(a.boxes).filter(k => a.boxes[k] !== undefined);
    const keysB = Object.keys(b.boxes).filter(k => b.boxes[k] !== undefined);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
      if (!shallowEqualDefined(a.boxes[k], b.boxes[k])) return false;
    }
  }

  return true;
}

function normalizeLoadedPlan(data: FloorplanData): FloorplanData {
  return {
    boxes: data.boxes ?? {},
    doors: data.doors ?? [],
    shapes: data.shapes ?? [],
    height: data.height ?? INITIAL_FLOORPLAN.height ?? 520,
    ...(data.floors?.length ? { floors: data.floors } : {}),
  };
}

function boxFor(plan: FloorplanData, zone: WarehouseZone, index: number, totalZones: number): FloorplanBox {
  return plan.boxes[zone.id] ?? defaultZoneBox(index, totalZones);
}

function clampRectBounds<T extends { x: number; y: number; w: number; h: number }>(rect: T, minW: number, minH: number): T {
  const w = r1(clampPct(rect.w, minW, 100));
  const h = r1(clampPct(rect.h, minH, 100));
  const x = r1(clampPct(rect.x, 0, 100 - w));
  const y = r1(clampPct(rect.y, 0, 100 - h));
  return { ...rect, x, y, w, h };
}

function computeMovedOrResizedBounds(
  orig: { x: number; y: number; w: number; h: number },
  mode: string,
  dx: number,
  dy: number,
  snapStep: number,
  minW: number,
  minH: number,
): { x: number; y: number; w: number; h: number } {
  if (mode === 'move') {
    const rawX = orig.x + dx;
    const rawY = orig.y + dy;
    const x = clampPct(snapStep > 0 ? snapPct(rawX, snapStep) : rawX, 0, 100 - orig.w);
    const y = clampPct(snapStep > 0 ? snapPct(rawY, snapStep) : rawY, 0, 100 - orig.h);
    return { x: r1(x), y: r1(y), w: orig.w, h: orig.h };
  }
  let left = orig.x;
  let right = orig.x + orig.w;
  let top = orig.y;
  let bottom = orig.y + orig.h;
  if (mode.includes('w')) {
    const nx = snapStep > 0 ? snapPct(orig.x + dx, snapStep) : orig.x + dx;
    left = clampPct(nx, 0, right - minW);
  }
  if (mode.includes('e')) {
    const nr = snapStep > 0 ? snapPct(orig.x + orig.w + dx, snapStep) : orig.x + orig.w + dx;
    right = clampPct(nr, left + minW, 100);
  }
  if (mode.includes('n')) {
    const ny = snapStep > 0 ? snapPct(orig.y + dy, snapStep) : orig.y + dy;
    top = clampPct(ny, 0, bottom - minH);
  }
  if (mode.includes('s')) {
    const nb = snapStep > 0 ? snapPct(orig.y + orig.h + dy, snapStep) : orig.y + orig.h + dy;
    bottom = clampPct(nb, top + minH, 100);
  }
  return { x: r1(left), y: r1(top), w: r1(right - left), h: r1(bottom - top) };
}

function nearestWallDoorPosition(px: number, py: number, snapStep: number): { edge: DoorEdge; offset: number } {
  const candidates: Array<{ edge: DoorEdge; dist: number; coord: number }> = [
    { edge: 'top', dist: py, coord: px },
    { edge: 'bottom', dist: 100 - py, coord: px },
    { edge: 'left', dist: px, coord: py },
    { edge: 'right', dist: 100 - px, coord: py },
  ];
  candidates.sort((a, b) => a.dist - b.dist);
  const nearest = candidates[0];
  const snapped = snapStep > 0 ? snapPct(nearest.coord, snapStep) : nearest.coord;
  return { edge: nearest.edge, offset: r1(clampPct(snapped, 2, 98)) };
}

interface ElementAppearance {
  className: string;
  style: React.CSSProperties;
  effectiveTextColor?: string;
}

const PRESET_RGB_ALPHA_MAP: Record<number, { hex: string; alpha: number }> = {
  0: { hex: '#F59E0B', alpha: 0.15 },
  1: { hex: '#10B981', alpha: 0.15 },
  2: { hex: '#8B5CF6', alpha: 0.15 },
  3: { hex: '#F59E0B', alpha: 0.2 },
  4: { hex: '#FFFFFF', alpha: 1 },
  5: { hex: '#94A3B8', alpha: 0.2 },
  6: { hex: '#0EA5E9', alpha: 0.15 },
};

function resolveElementAppearance(
  el: Pick<FloorplanBox, 'color' | 'border' | 'fillColor' | 'fillOpacity' | 'textColor'>,
  isLabel: boolean,
  isZone: boolean,
  onionView: boolean,
): ElementAppearance {
  const palette = FLOORPLAN_COLORS[el.color] ?? FLOORPLAN_COLORS[0];
  const effectiveBorder: BorderStyle = el.border ?? (isLabel ? 'none' : 'solid');
  const strokeWidth = isZone && effectiveBorder !== 'none' ? 'border-2' : 'border';
  const borderStyleCls =
    effectiveBorder === 'none' ? 'border-transparent' : effectiveBorder === 'dashed' ? 'border-dashed' : 'border-solid';

  const inlineStyle: React.CSSProperties = {};
  let className = '';

  if (el.fillColor || el.fillOpacity !== undefined) {
    const presetFallback = PRESET_RGB_ALPHA_MAP[el.color] ?? PRESET_RGB_ALPHA_MAP[4];
    const baseHex = el.fillColor ?? presetFallback.hex;
    const baseAlpha = el.fillOpacity ?? (el.fillColor ? 1 : presetFallback.alpha);
    const displayAlpha = onionView ? Math.min(baseAlpha, 0.45) : baseAlpha;
    inlineStyle.backgroundColor = displayAlpha <= 0 ? 'transparent' : hexToRgba(baseHex, displayAlpha);
    if (effectiveBorder !== 'none') {
      inlineStyle.borderColor = computeContrastBorderHex(baseHex);
    }
    className = `${strokeWidth} ${borderStyleCls} text-foreground`;
  } else if (isLabel && effectiveBorder === 'none' && el.color === 4) {
    className = 'bg-transparent border border-transparent text-foreground';
  } else {
    const basePreset =
      effectiveBorder === 'none' ? palette.className.replace(/\bborder-\S+/g, '').trim() : palette.className;
    className = `${basePreset} ${strokeWidth} ${borderStyleCls}`;
    if (onionView) {
      const presetFallback = PRESET_RGB_ALPHA_MAP[el.color] ?? PRESET_RGB_ALPHA_MAP[4];
      inlineStyle.backgroundColor = hexToRgba(presetFallback.hex, Math.min(presetFallback.alpha, 0.48));
    }
  }

  let effectiveTextColor: string | undefined;
  if (el.textColor) {
    effectiveTextColor = el.textColor;
    inlineStyle.color = el.textColor;
  } else if (el.fillColor && (el.fillOpacity ?? 1) >= 0.55 && !onionView && isDarkHexColor(el.fillColor)) {
    effectiveTextColor = '#FFFFFF';
    inlineStyle.color = '#FFFFFF';
  }

  return { className, style: inlineStyle, effectiveTextColor };
}

function textFormatClasses(
  bold: boolean | undefined,
  italic: boolean | undefined,
  underline: boolean | undefined,
  role: 'zone-title' | 'zone-sublabel' | 'shape',
): string {
  const weight =
    bold === true
      ? role === 'zone-title'
        ? 'font-extrabold'
        : 'font-bold'
      : bold === false
        ? role === 'zone-title'
          ? 'font-medium'
          : 'font-normal'
        : role === 'zone-title'
          ? 'font-semibold'
          : role === 'zone-sublabel'
            ? 'font-normal'
            : 'font-medium';
  return `${weight} ${italic ? 'italic' : ''} ${underline ? 'underline underline-offset-2' : ''}`.trim();
}

function lineStrokeClass(lineColor: LineColor | undefined): string {
  switch (lineColor) {
    case 'blue':
      return 'stroke-sky-500';
    case 'muted':
      return 'stroke-muted-foreground/70';
    case 'gold':
      return 'stroke-amber-500';
    case 'red':
      return 'stroke-rose-500';
    case 'dark':
    default:
      return 'stroke-foreground/85';
  }
}

function rotatedTextStyle(rotate: TextRotation | undefined): React.CSSProperties | undefined {
  if (rotate === 90) return { writingMode: 'vertical-rl' };
  if (rotate === -90) return { writingMode: 'vertical-rl', transform: 'rotate(180deg)' };
  if (rotate === 180) return { transform: 'rotate(180deg)' };
  return undefined;
}

function LineNumberInput({
  label,
  value,
  min,
  max,
  step = 0.5,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (next: number) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        className="w-16 rounded border bg-background px-1.5 py-1 text-foreground"
        value={focused ? draft : value}
        onFocus={() => {
          setFocused(true);
          setDraft(String(value));
        }}
        onBlur={() => setFocused(false)}
        onChange={e => {
          const raw = e.target.value;
          setDraft(raw);
          if (raw.trim() === '' || raw.trim() === '-') return;
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) onCommit(parsed);
        }}
      />
    </label>
  );
}

function ResizeHandles({
  sizeClass = 'size-3',
  onHandlePointerDown,
}: {
  sizeClass?: string;
  onHandlePointerDown: (e: PointerEvent<HTMLSpanElement>, handle: string) => void;
}) {
  return (
    <>
      {HANDLES.map(handle => (
        <span
          key={handle}
          aria-hidden="true"
          onPointerDown={e => onHandlePointerDown(e, handle)}
          className={`pointer-events-auto absolute z-10 ${sizeClass} touch-none border-2 border-gold bg-card shadow-2xs`}
          style={{
            left: handle.includes('w') ? '0%' : handle.includes('e') ? '100%' : '50%',
            top: handle.includes('n') ? '0%' : handle.includes('s') ? '100%' : '50%',
            transform: 'translate(-50%, -50%)',
            cursor: `${handle}-resize`,
          }}
        />
      ))}
    </>
  );
}

export const WarehouseFloorplan = memo(function WarehouseFloorplan({
  warehouseId,
  storageKey,
  zones,
  canEdit,
  compact = false,
  selected,
  resetKey = 0,
  highlightedZones,
  pendingZoneConversion,
  onDirtyChange,
  onSelect,
  onZoneAction,
  onClearAllZones,
  summary,
}: {
  warehouseId: string;
  storageKey: string;
  zones: WarehouseZone[];
  canEdit: boolean;
  compact?: boolean;
  selected: string;
  resetKey?: number;
  highlightedZones?: Record<string, { units: number; products: number }>;
  pendingZoneConversion?: PendingZoneConversion | null;
  onDirtyChange?: (dirty: boolean) => void;
  onSelect: (id: string) => void;
  onZoneAction: (mode: 'add' | 'rename' | 'delete', zone?: WarehouseZone, fromShape?: FloorplanShape) => void;
  onClearAllZones?: () => void;
  summary: (id: string) => { units: number; products: number };
}) {
  const [doc, setDoc] = useState<FloorplanHistoryDoc>(() => ({
    plan: normalizeLoadedPlan(INITIAL_FLOORPLAN),
    undo: [],
    redo: [],
  }));
  const plan = doc.plan;

  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<ToolMode>('select');
  const [keepToolActive, setKeepToolActive] = useState(false);
  const [chosen, setChosen] = useState<ChosenTarget>(null);
  const [multiSelected, setMultiSelected] = useState<SelectedRef[]>([]);
  const [focusedZoneId, setFocusedZoneId] = useState('');
  const [snapStep, setSnapStep] = useState<0 | 1 | 2 | 5>(1);
  const [showGrid, setShowGrid] = useState(true);
  const [onionView, setOnionView] = useState(false);
  const [lastCustomHeight, setLastCustomHeight] = useState<number | null>(null);
  const [activeFloorId, setActiveFloorId] = useState('');
  const [floorModal, setFloorModal] = useState<{ mode: 'add' | 'rename'; floorId?: string } | null>(null);
  const [floorNameInput, setFloorNameInput] = useState('');

  const [traceUrl, setTraceUrl] = useState<string | null>(null);
  const [traceOpacity, setTraceOpacity] = useState(0.35);
  const [traceVisible, setTraceVisible] = useState(true);
  const [traceScale, setTraceScale] = useState(1);
  const [traceOffsetX, setTraceOffsetX] = useState(0);
  const [traceOffsetY, setTraceOffsetY] = useState(0);
  const [traceNaturalRatio, setTraceNaturalRatio] = useState<number | null>(null);

  const [editingInlineId, setEditingInlineId] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState('');
  const [copiedStyle, setCopiedStyle] = useState<CopiedFloorplanStyle | null>(null);
  const [pendingDraft, setPendingDraft] = useState<FloorplanData | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const [drawPreview, setDrawPreview] = useState<DrawSession | null>(null);
  const [marqueePreview, setMarqueePreview] = useState<MarqueeSession | null>(null);

  const [local, setLocal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const saved = useRef(plan);
  const canvasRef = useRef<HTMLDivElement>(null);
  const traceInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const drawRef = useRef<DrawSession | null>(null);
  const marqueeRef = useRef<MarqueeSession | null>(null);
  const lastConversionSeqRef = useRef(0);
  const editable = editing && canEdit && !saving;
  const draftStorageKey = `${storageKey}:floorplan:draft`;
  const isDirty = useMemo(
    () => editing && !areFloorplansEqual(plan, saved.current),
    [editing, plan],
  );
  const floors = plan.floors ?? EMPTY_FLOORS;
  const currentCanvasHeight = plan.height ?? 520;
  const isCurrentPresetHeight = FLOORPLAN_HEIGHT_PRESETS.some(preset => preset.value === currentCanvasHeight);

  useEffect(() => {
    if (!isCurrentPresetHeight) {
      setLastCustomHeight(currentCanvasHeight);
    }
  }, [isCurrentPresetHeight, currentCanvasHeight]);

  const effectiveFloorId = useMemo(() => {
    if (compact && selected && floors.length > 1) {
      return resolveEffectiveFloorId(plan.boxes[selected]?.floor, floors);
    }
    if (floors.length === 0) return 'default';
    return floors.some(f => f.id === activeFloorId) ? activeFloorId : floors[0].id;
  }, [compact, selected, floors, plan.boxes, activeFloorId]);

  useEffect(() => {
    return () => {
      if (traceUrl) URL.revokeObjectURL(traceUrl);
    };
  }, [traceUrl]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (compact || !editing || !isDirty) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(draftStorageKey, JSON.stringify(plan));
      } catch {
        // Ignore storage quota warnings on draft backup
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [compact, editing, isDirty, plan, draftStorageKey]);

  useEffect(() => {
    setFocusedZoneId(prev => (zones.some(z => z.id === prev) ? prev : ''));
    setChosen(prev => {
      if (!prev) return null;
      if (prev.kind === 'zone') return zones.some(z => z.id === prev.id) ? prev : null;
      if (prev.kind === 'door') return plan.doors.some(d => d.id === prev.id) ? prev : null;
      return (plan.shapes ?? []).some(s => s.id === prev.id) ? prev : null;
    });
    setMultiSelected(prev =>
      prev.filter(item =>
        item.kind === 'zone' ? zones.some(z => z.id === item.id) : (plan.shapes ?? []).some(s => s.id === item.id),
      ),
    );
  }, [zones, plan.doors, plan.shapes]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setPendingDraft(null);
    setLastCustomHeight(null);
    setTraceUrl(null);
    async function load() {
      try {
        const result = await supabase.from('warehouse_floorplans').select('layout').eq('warehouseId', warehouseId).maybeSingle();
        if (!active) return;
        let value: unknown = result.data?.layout || INITIAL_FLOORPLAN;
        const fallback = !!result.error && ['PGRST205', '42P01'].includes(result.error.code);
        if (result.error && !fallback) throw result.error;
        if (fallback) {
          try {
            const raw = window.localStorage.getItem(`${storageKey}:floorplan`);
            value = (raw ? JSON.parse(raw) : null) || INITIAL_FLOORPLAN;
          } catch {
            value = INITIAL_FLOORPLAN;
          }
        }
        if (!validFloorplan(value)) throw new Error('The saved floorplan is unreadable. It has not been overwritten.');
        const normalized = normalizeLoadedPlan(value);
        writeCachedFloorplanMeta(storageKey, normalized);
        setDoc({ plan: normalized, undo: [], redo: [] });
        saved.current = normalized;
        setLocal(fallback);
        setActiveFloorId(normalized.floors?.[0]?.id || '');
        if (!compact && canEdit) {
          try {
            const rawDraft = window.localStorage.getItem(`${storageKey}:floorplan:draft`);
            if (rawDraft) {
              const parsedDraft = JSON.parse(rawDraft);
              if (validFloorplan(parsedDraft)) {
                const normalizedDraft = normalizeLoadedPlan(parsedDraft);
                if (!areFloorplansEqual(normalizedDraft, normalized)) {
                  setPendingDraft(normalizedDraft);
                } else {
                  window.localStorage.removeItem(`${storageKey}:floorplan:draft`);
                }
              } else {
                window.localStorage.removeItem(`${storageKey}:floorplan:draft`);
              }
            }
          } catch {
            // Ignore malformed local draft
          }
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [warehouseId, storageKey, resetKey]);

  useEffect(() => {
    if (!pendingZoneConversion || pendingZoneConversion.seq <= lastConversionSeqRef.current) return;
    lastConversionSeqRef.current = pendingZoneConversion.seq;
    const { sourceShapeId, zoneId, box } = pendingZoneConversion;

    setDoc(d => ({
      ...d,
      plan: {
        ...d.plan,
        boxes: { ...d.plan.boxes, [zoneId]: box },
        shapes: (d.plan.shapes ?? []).filter(s => s.id !== sourceShapeId),
      },
    }));
    setChosen({ kind: 'zone', id: zoneId });
    setMultiSelected([{ kind: 'zone', id: zoneId }]);

    // Persist newly created zone box into saved baseline so cancelling later does not strip its coordinates
    const nextSaved: FloorplanData = {
      ...saved.current,
      boxes: { ...saved.current.boxes, [zoneId]: box },
      shapes: (saved.current.shapes ?? []).filter(s => s.id !== sourceShapeId),
    };
    saved.current = nextSaved;
    if (local) {
      try {
        window.localStorage.setItem(`${storageKey}:floorplan`, JSON.stringify(nextSaved));
      } catch {
        // Ignore storage error
      }
    } else {
      void supabase.from('warehouse_floorplans').upsert({ warehouseId, layout: nextSaved }, { onConflict: 'warehouseId' });
    }
  }, [pendingZoneConversion, local, storageKey, warehouseId]);

  useEffect(() => {
    if (!canEdit) {
      setEditing(false);
      setTool('select');
      setChosen(null);
      setMultiSelected([]);
      setEditingInlineId(null);
      setDoc({ plan: saved.current, undo: [], redo: [] });
      dragRef.current = null;
      drawRef.current = null;
      marqueeRef.current = null;
      setDrawPreview(null);
      setMarqueePreview(null);
    }
  }, [canEdit]);

  function applyChange(updater: (prev: FloorplanData) => FloorplanData) {
    setDoc(d => {
      const next = updater(d.plan);
      if (next === d.plan) return d;
      return {
        plan: next,
        undo: [...d.undo.slice(-(MAX_HISTORY - 1)), d.plan],
        redo: [],
      };
    });
  }

  function undo() {
    setDoc(d => {
      if (!d.undo.length) return d;
      const previous = d.undo[d.undo.length - 1];
      return {
        plan: previous,
        undo: d.undo.slice(0, -1),
        redo: [...d.redo.slice(-(MAX_HISTORY - 1)), d.plan],
      };
    });
  }

  function redo() {
    setDoc(d => {
      if (!d.redo.length) return d;
      const restored = d.redo[d.redo.length - 1];
      return {
        plan: restored,
        undo: [...d.undo.slice(-(MAX_HISTORY - 1)), d.plan],
        redo: d.redo.slice(0, -1),
      };
    });
  }

  const currentFloorProp = floors.length > 1 ? { floor: effectiveFloorId } : {};

  function selectSingleTarget(target: ChosenTarget) {
    setChosen(target);
    if (target && (target.kind === 'zone' || target.kind === 'shape')) {
      setMultiSelected([{ kind: target.kind, id: target.id }]);
    } else {
      setMultiSelected([]);
    }
  }

  function toggleTargetInSelection(ref: SelectedRef) {
    setMultiSelected(prev => {
      const exists = prev.some(item => item.kind === ref.kind && item.id === ref.id);
      const next = exists ? prev.filter(item => !(item.kind === ref.kind && item.id === ref.id)) : [...prev, ref];
      if (next.length === 1) setChosen(next[0]);
      else setChosen(null);
      return next;
    });
  }

  function getSelectedBoundsItems(targetPlan: FloorplanData = plan): FloorplanBoundsItem[] {
    const out: FloorplanBoundsItem[] = [];
    for (const ref of multiSelected) {
      if (ref.kind === 'zone') {
        const idx = zones.findIndex(z => z.id === ref.id);
        if (idx !== -1) {
          const b = boxFor(targetPlan, zones[idx], idx, zones.length);
          out.push({ kind: 'zone', id: ref.id, x: b.x, y: b.y, w: b.w, h: b.h });
        }
      } else {
        const s = (targetPlan.shapes ?? []).find(sh => sh.id === ref.id);
        if (s) {
          if (s.kind === 'line') {
            const pts = getLineEndpoints(s);
            const minX = Math.min(pts.x1, pts.x2);
            const minY = Math.min(pts.y1, pts.y2);
            out.push({
              kind: 'shape',
              id: s.id,
              x: minX,
              y: minY,
              w: Math.max(0.1, Math.abs(pts.x2 - pts.x1)),
              h: Math.max(0.1, Math.abs(pts.y2 - pts.y1)),
            });
          } else {
            out.push({ kind: 'shape', id: s.id, x: s.x, y: s.y, w: s.w, h: s.h });
          }
        }
      }
    }
    return out;
  }

  function applyDeltasMapToPlan(basePlan: FloorplanData, deltas: Record<string, { dx: number; dy: number }>): FloorplanData {
    const nextBoxes = { ...basePlan.boxes };
    let boxesChanged = false;
    zones.forEach((z, idx) => {
      const delta = deltas[itemSelectionKey('zone', z.id)];
      if (!delta || (delta.dx === 0 && delta.dy === 0)) return;
      const cur = boxFor(basePlan, z, idx, zones.length);
      nextBoxes[z.id] = {
        ...cur,
        x: r1(clampPct(cur.x + delta.dx, 0, 100 - cur.w)),
        y: r1(clampPct(cur.y + delta.dy, 0, 100 - cur.h)),
      };
      boxesChanged = true;
    });

    let shapesChanged = false;
    const nextShapes = (basePlan.shapes ?? []).map(s => {
      const delta = deltas[itemSelectionKey('shape', s.id)];
      if (!delta || (delta.dx === 0 && delta.dy === 0)) return s;
      shapesChanged = true;
      if (s.kind === 'line') {
        const moved = moveLinePoints(getLineEndpoints(s), delta.dx, delta.dy, 0, false);
        return { ...s, ...shapeGeometryFromLinePoints(moved) };
      }
      return {
        ...s,
        x: r1(clampPct(s.x + delta.dx, 0, 100 - s.w)),
        y: r1(clampPct(s.y + delta.dy, 0, 100 - s.h)),
      };
    });

    if (!boxesChanged && !shapesChanged) return basePlan;
    return {
      ...basePlan,
      ...(boxesChanged ? { boxes: nextBoxes } : {}),
      ...(shapesChanged ? { shapes: nextShapes } : {}),
    };
  }

  function handleAlignSelection(mode: AlignMode) {
    const items = getSelectedBoundsItems();
    if (items.length < 2) return;
    const deltas = computeAlignDeltas(items, mode);
    applyChange(p => applyDeltasMapToPlan(p, deltas));
  }

  function handleDistributeSelection(axis: DistributeAxis) {
    const items = getSelectedBoundsItems();
    if (items.length < 3) return;
    const deltas = computeDistributeDeltas(items, axis);
    applyChange(p => applyDeltasMapToPlan(p, deltas));
  }

  function handleMatchSelectionSize(mode: MatchSizeMode) {
    const rectItems = getSelectedBoundsItems().filter(item => {
      if (item.kind === 'zone') return true;
      const shape = (plan.shapes ?? []).find(s => s.id === item.id);
      return shape && shape.kind !== 'line';
    });
    if (rectItems.length < 2) return;
    const sizes = computeMatchSizes(rectItems, rectItems[0], mode);
    applyChange(p => {
      const nextBoxes = { ...p.boxes };
      zones.forEach((z, idx) => {
        const upd = sizes[itemSelectionKey('zone', z.id)];
        if (!upd) return;
        const cur = boxFor(p, z, idx, zones.length);
        nextBoxes[z.id] = { ...cur, ...upd };
      });
      const nextShapes = (p.shapes ?? []).map(s => {
        const upd = sizes[itemSelectionKey('shape', s.id)];
        return upd ? { ...s, ...upd } : s;
      });
      return { ...p, boxes: nextBoxes, shapes: nextShapes };
    });
  }

  function addLabel() {
    const id = crypto.randomUUID();
    const count = (plan.shapes ?? []).filter(s => s.kind === 'label').length;
    const shape: FloorplanShape = {
      id,
      kind: 'label',
      label: 'Label',
      x: 42,
      y: clampPct(8 + (count % 5) * 6, 2, 90),
      w: 16,
      h: 6,
      color: 4,
      border: 'none',
      fontSize: 'sm',
      rotate: 0,
      align: 'center',
      z: 30,
      ...currentFloorProp,
    };
    applyChange(p => ({ ...p, shapes: [...(p.shapes ?? []), shape] }));
    if (!keepToolActive) setTool('select');
    selectSingleTarget({ kind: 'shape', id });
  }

  function addDoor() {
    const id = crypto.randomUUID();
    const offset = clampPct(22 + (plan.doors.length % 6) * 12, 8, 92);
    const door: FloorplanDoor = { id, edge: 'bottom', offset, ...currentFloorProp };
    applyChange(p => ({ ...p, doors: [...p.doors, door] }));
    if (!keepToolActive) setTool('select');
    selectSingleTarget({ kind: 'door', id });
  }

  function handleDuplicateSelection() {
    const shapeIds =
      multiSelected.length >= 2
        ? multiSelected.filter(i => i.kind === 'shape').map(i => i.id)
        : chosen?.kind === 'shape'
          ? [chosen.id]
          : [];
    if (!shapeIds.length) return;
    const copies = shapeIds
      .map(id => (plan.shapes ?? []).find(s => s.id === id))
      .filter((s): s is FloorplanShape => Boolean(s))
      .map(src => duplicateShape(src, crypto.randomUUID()));
    if (!copies.length) return;
    applyChange(p => ({ ...p, shapes: [...(p.shapes ?? []), ...copies] }));
    if (copies.length === 1) {
      selectSingleTarget({ kind: 'shape', id: copies[0].id });
    } else {
      setChosen(null);
      setMultiSelected(copies.map(c => ({ kind: 'shape', id: c.id })));
    }
  }

  function removeSelected() {
    if (multiSelected.length >= 2) {
      const shapeIds = new Set(multiSelected.filter(i => i.kind === 'shape').map(i => i.id));
      const hasZones = multiSelected.some(i => i.kind === 'zone');
      if (shapeIds.size > 0) {
        applyChange(p => ({ ...p, shapes: (p.shapes ?? []).filter(s => !shapeIds.has(s.id)) }));
      }
      setMultiSelected(prev => prev.filter(i => i.kind === 'zone'));
      setChosen(null);
      if (hasZones) {
        toast.info('Shapes removed. Delete inventory zones individually to protect stock records.');
      }
      return;
    }
    if (!chosen) return;
    if (chosen.kind === 'shape') {
      const id = chosen.id;
      applyChange(p => ({ ...p, shapes: (p.shapes ?? []).filter(s => s.id !== id) }));
      selectSingleTarget(null);
    } else if (chosen.kind === 'door') {
      const id = chosen.id;
      applyChange(p => ({ ...p, doors: p.doors.filter(d => d.id !== id) }));
      selectSingleTarget(null);
    } else if (chosen.kind === 'zone') {
      const targetZone = zones.find(z => z.id === chosen.id);
      if (targetZone) onZoneAction('delete', targetZone);
    }
  }

  const onKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyDownRef.current = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const visibleRefs: SelectedRef[] = [
          ...zones
            .filter((z, idx) => belongsToFloor(boxFor(plan, z, idx, zones.length).floor, effectiveFloorId, floors))
            .map(z => ({ kind: 'zone' as const, id: z.id })),
          ...(plan.shapes ?? [])
            .filter(s => belongsToFloor(s.floor, effectiveFloorId, floors))
            .map(s => ({ kind: 'shape' as const, id: s.id })),
        ];
        setTool('select');
        setMultiSelected(visibleRefs);
        setChosen(visibleRefs.length === 1 ? visibleRefs[0] : null);
        return;
      }
      if (mod && e.key.toLowerCase() === 'd' && (chosen?.kind === 'shape' || multiSelected.some(i => i.kind === 'shape'))) {
        e.preventDefault();
        handleDuplicateSelection();
        return;
      }
      if (e.key === 'Escape') {
        if (editingInlineId) {
          setEditingInlineId(null);
          return;
        }
        if (tool !== 'select') setTool('select');
        else selectSingleTarget(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (chosen || multiSelected.length > 0)) {
        e.preventDefault();
        removeSelected();
        return;
      }
      if ((chosen || multiSelected.length > 0) && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 2 : snapStep > 0 ? snapStep : 0.5;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        if (multiSelected.length >= 2) {
          const items = getSelectedBoundsItems();
          const clamped = clampGroupDelta(items, dx, dy, snapStep, false);
          const deltas = Object.fromEntries(items.map(i => [itemSelectionKey(i.kind, i.id), clamped]));
          applyChange(p => applyDeltasMapToPlan(p, deltas));
          return;
        }
        if (chosen?.kind === 'door') {
          applyChange(p => ({
            ...p,
            doors: p.doors.map(d => {
              if (d.id !== chosen.id) return d;
              const delta = d.edge === 'top' || d.edge === 'bottom' ? dx : dy;
              return { ...d, offset: r1(clampPct(d.offset + delta, 2, 98)) };
            }),
          }));
        } else if (chosen?.kind === 'shape') {
          applyChange(p => ({
            ...p,
            shapes: (p.shapes ?? []).map(s => {
              if (s.id !== chosen.id) return s;
              if (s.kind === 'line') {
                const moved = moveLinePoints(getLineEndpoints(s), dx, dy, snapStep, false);
                return { ...s, ...shapeGeometryFromLinePoints(moved) };
              }
              return {
                ...s,
                x: r1(clampPct(s.x + dx, 0, 100 - s.w)),
                y: r1(clampPct(s.y + dy, 0, 100 - s.h)),
              };
            }),
          }));
        } else if (chosen?.kind === 'zone') {
          const idx = zones.findIndex(z => z.id === chosen.id);
          if (idx === -1) return;
          applyChange(p => {
            const current = boxFor(p, zones[idx], idx, zones.length);
            return {
              ...p,
              boxes: {
                ...p.boxes,
                [chosen.id]: {
                  ...current,
                  x: r1(clampPct(current.x + dx, 0, 100 - current.w)),
                  y: r1(clampPct(current.y + dy, 0, 100 - current.h)),
                },
              },
            };
          });
        }
      }
  };

  useEffect(() => {
    if (!editable) return;
    const onKeyDown = (e: KeyboardEvent) => onKeyDownRef.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editable]);

  async function save() {
    if (!editable) return;
    setSaving(true);
    const nextBoxes = Object.fromEntries(
      zones.map((z, i) => [z.id, clampRectBounds(boxFor(plan, z, i, zones.length), 2, 2)]),
    );
    const nextShapes = (plan.shapes ?? []).map(s => {
      if (s.kind === 'line') {
        return {
          ...s,
          ...shapeGeometryFromLinePoints(getLineEndpoints(s)),
          lineWidth: resolveLineWidth(s.lineWidth),
          lineStyle: s.lineStyle ?? 'solid',
        };
      }
      return clampRectBounds(s, 2, 2);
    });
    const nextDoors = plan.doors.map(d => ({ ...d, offset: r1(clampPct(d.offset, 2, 98)) }));
    const next: FloorplanData = {
      boxes: nextBoxes,
      doors: nextDoors,
      shapes: nextShapes,
      height: clampPct(plan.height ?? INITIAL_FLOORPLAN.height ?? 520, 300, 1600),
      ...(plan.floors?.length ? { floors: plan.floors } : {}),
    };
    if (!validFloorplan(next)) {
      toast.error('Floorplan layout is invalid and cannot be saved.');
      setSaving(false);
      return;
    }
    try {
      if (local) {
        try {
          window.localStorage.setItem(`${storageKey}:floorplan`, JSON.stringify(next));
        } catch {
          throw new Error('Browser storage is full or unavailable.');
        }
      } else {
        const result = await supabase.from('warehouse_floorplans').upsert({ warehouseId, layout: next }, { onConflict: 'warehouseId' });
        if (result.error) throw result.error;
      }
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        // ignore cleanup error
      }
      saved.current = next;
      writeCachedFloorplanMeta(storageKey, next);
      setDoc({ plan: next, undo: [], redo: [] });
      setEditing(false);
      setTool('select');
      selectSingleTarget(null);
      setEditingInlineId(null);
      setPendingDraft(null);
      toast.success('Layout saved');
    } catch (e) {
      toast.error((e as Error).message || 'Unable to save layout');
    } finally {
      setSaving(false);
    }
  }

  function pointerToPct(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const x = clampPct(((clientX - rect.left) / rect.width) * 100, 0, 100);
    const y = clampPct(((clientY - rect.top) / rect.height) * 100, 0, 100);
    return { x, y, rect };
  }

  function startElementDrag(
    e: PointerEvent,
    targetKind: 'zone' | 'shape' | 'door',
    id: string,
    mode: string,
    origBounds?: { x: number; y: number; w: number; h: number },
    origDoor?: FloorplanDoor,
    origLinePoints?: LinePoints,
  ) {
    if (!editable || tool !== 'select' || e.button !== 0) return;
    if (editingInlineId && editingInlineId === id) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey && (targetKind === 'zone' || targetKind === 'shape') && mode === 'move') {
      toggleTargetInSelection({ kind: targetKind, id });
      return;
    }

    const inMultiGroup =
      multiSelected.length >= 2 &&
      mode === 'move' &&
      (targetKind === 'zone' || targetKind === 'shape') &&
      multiSelected.some(item => item.kind === targetKind && item.id === id);

    if (inMultiGroup) {
      const origins: GroupOriginItem[] = getSelectedBoundsItems().map(item => {
        if (item.kind === 'shape') {
          const shape = (plan.shapes ?? []).find(s => s.id === item.id);
          if (shape?.kind === 'line') {
            return { ...item, linePoints: getLineEndpoints(shape) };
          }
        }
        return item;
      });
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        targetKind: 'group',
        id,
        mode: 'group-move',
        startClientX: e.clientX,
        startClientY: e.clientY,
        groupOrigins: origins,
        basePlan: plan,
        moved: false,
      };
      return;
    }

    selectSingleTarget({ kind: targetKind, id });
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      targetKind,
      id,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origBounds,
      origLinePoints,
      origDoor,
      basePlan: plan,
      moved: false,
    };
  }

  function handleCanvasPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!editable || e.button !== 0) return;
    if (tool === 'draw-box' || tool === 'draw-line') {
      const pt = pointerToPct(e.clientX, e.clientY);
      if (!pt) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const session: DrawSession = {
        pointerId: e.pointerId,
        kind: tool === 'draw-box' ? 'box' : 'line',
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
        shiftKey: e.shiftKey,
      };
      drawRef.current = session;
      setDrawPreview(session);
    } else if (e.target === e.currentTarget) {
      const pt = pointerToPct(e.clientX, e.clientY);
      if (!pt) {
        if (!e.shiftKey) selectSingleTarget(null);
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      const session: MarqueeSession = {
        pointerId: e.pointerId,
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
        additive: e.shiftKey,
      };
      marqueeRef.current = session;
      setMarqueePreview(session);
    }
  }

  function handleCanvasPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!editable) return;
    const activeMarquee = marqueeRef.current;
    if (activeMarquee && activeMarquee.pointerId === e.pointerId) {
      const pt = pointerToPct(e.clientX, e.clientY);
      if (!pt) return;
      const updated = { ...activeMarquee, x2: pt.x, y2: pt.y };
      marqueeRef.current = updated;
      setMarqueePreview(updated);
      return;
    }

    const activeDraw = drawRef.current;
    if (activeDraw && activeDraw.pointerId === e.pointerId) {
      const pt = pointerToPct(e.clientX, e.clientY);
      if (!pt) return;
      const updated: DrawSession = { ...activeDraw, x2: pt.x, y2: pt.y, shiftKey: e.shiftKey };
      drawRef.current = updated;
      setDrawPreview(updated);
      return;
    }

    const d = dragRef.current;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!d || !bounds || bounds.width <= 0 || bounds.height <= 0 || d.pointerId !== e.pointerId) return;
    const dx = ((e.clientX - d.startClientX) / bounds.width) * 100;
    const dy = ((e.clientY - d.startClientY) / bounds.height) * 100;
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) d.moved = true;

    if (d.targetKind === 'group' && d.groupOrigins) {
      const delta = clampGroupDelta(d.groupOrigins, dx, dy, snapStep, true);
      const nextBoxes = { ...d.basePlan.boxes };
      const zoneOrigins = new Map(d.groupOrigins.filter(o => o.kind === 'zone').map(o => [o.id, o]));
      const shapeOrigins = new Map(d.groupOrigins.filter(o => o.kind === 'shape').map(o => [o.id, o]));

      zones.forEach((z, idx) => {
        const origin = zoneOrigins.get(z.id);
        if (!origin) return;
        const cur = boxFor(d.basePlan, z, idx, zones.length);
        nextBoxes[z.id] = {
          ...cur,
          x: r1(clampPct(origin.x + delta.dx, 0, 100 - origin.w)),
          y: r1(clampPct(origin.y + delta.dy, 0, 100 - origin.h)),
        };
      });

      const nextShapes = (d.basePlan.shapes ?? []).map(s => {
        const origin = shapeOrigins.get(s.id);
        if (!origin) return s;
        if (s.kind === 'line' && origin.linePoints) {
          const moved = moveLinePoints(origin.linePoints, delta.dx, delta.dy, 0, false);
          return { ...s, ...shapeGeometryFromLinePoints(moved) };
        }
        return {
          ...s,
          x: r1(clampPct(origin.x + delta.dx, 0, 100 - origin.w)),
          y: r1(clampPct(origin.y + delta.dy, 0, 100 - origin.h)),
        };
      });

      setDoc(curr => ({
        ...curr,
        plan: { ...curr.plan, boxes: nextBoxes, shapes: nextShapes },
      }));
      return;
    }

    if (d.targetKind === 'door' && d.origDoor) {
      const px = clampPct(((e.clientX - bounds.left) / bounds.width) * 100, 0, 100);
      const py = clampPct(((e.clientY - bounds.top) / bounds.height) * 100, 0, 100);
      const nextPos = nearestWallDoorPosition(px, py, snapStep);
      setDoc(curr => ({
        ...curr,
        plan: {
          ...curr.plan,
          doors: curr.plan.doors.map(door => (door.id === d.id ? { ...door, ...nextPos } : door)),
        },
      }));
      return;
    }

    if (d.targetKind === 'shape' && d.origLinePoints) {
      let nextPts = d.origLinePoints;
      if (d.mode === 'move') {
        nextPts = moveLinePoints(d.origLinePoints, dx, dy, snapStep, true);
      } else if (d.mode === 'p1' || d.mode === 'p2') {
        const rawX = (d.mode === 'p1' ? d.origLinePoints.x1 : d.origLinePoints.x2) + dx;
        const rawY = (d.mode === 'p1' ? d.origLinePoints.y1 : d.origLinePoints.y2) + dy;
        nextPts = updateLineEndpoint(d.origLinePoints, d.mode, rawX, rawY, snapStep, e.shiftKey);
      }
      const nextGeom = shapeGeometryFromLinePoints(nextPts);
      setDoc(curr => ({
        ...curr,
        plan: {
          ...curr.plan,
          shapes: (curr.plan.shapes ?? []).map(s => (s.id === d.id ? { ...s, ...nextGeom } : s)),
        },
      }));
      return;
    }

    if (d.origBounds) {
      if (d.targetKind === 'shape') {
        const targetShape = d.basePlan.shapes?.find(s => s.id === d.id);
        if (!targetShape) return;
        const minW = targetShape.kind === 'line' ? 0.5 : 2;
        const minH = targetShape.kind === 'line' ? 0.5 : 2;
        const nextRect = computeMovedOrResizedBounds(d.origBounds, d.mode, dx, dy, snapStep, minW, minH);
        setDoc(curr => ({
          ...curr,
          plan: {
            ...curr.plan,
            shapes: (curr.plan.shapes ?? []).map(s => (s.id === d.id ? { ...s, ...nextRect } : s)),
          },
        }));
      } else if (d.targetKind === 'zone') {
        const nextRect = computeMovedOrResizedBounds(d.origBounds, d.mode, dx, dy, snapStep, 2, 2);
        const origZoneBox = d.basePlan.boxes[d.id] ?? { color: 0, ...d.origBounds };
        setDoc(curr => ({
          ...curr,
          plan: {
            ...curr.plan,
            boxes: { ...curr.plan.boxes, [d.id]: { ...origZoneBox, ...nextRect } },
          },
        }));
      }
    }
  }

  function finishPointerInteraction(e: PointerEvent<HTMLDivElement>) {
    const activeMarquee = marqueeRef.current;
    if (activeMarquee && activeMarquee.pointerId === e.pointerId) {
      marqueeRef.current = null;
      setMarqueePreview(null);
      const isClickOnly = Math.abs(activeMarquee.x2 - activeMarquee.x1) < 1 && Math.abs(activeMarquee.y2 - activeMarquee.y1) < 1;
      if (isClickOnly) {
        if (!activeMarquee.additive) selectSingleTarget(null);
        return;
      }
      const box = {
        x: Math.min(activeMarquee.x1, activeMarquee.x2),
        y: Math.min(activeMarquee.y1, activeMarquee.y2),
        w: Math.abs(activeMarquee.x2 - activeMarquee.x1),
        h: Math.abs(activeMarquee.y2 - activeMarquee.y1),
      };
      const hits: SelectedRef[] = [];
      zones.forEach((z, idx) => {
        const b = boxFor(plan, z, idx, zones.length);
        if (!belongsToFloor(b.floor, effectiveFloorId, floors)) return;
        if (rectIntersects(box, b)) hits.push({ kind: 'zone', id: z.id });
      });
      (plan.shapes ?? []).forEach(s => {
        if (!belongsToFloor(s.floor, effectiveFloorId, floors)) return;
        if (rectIntersects(box, s)) hits.push({ kind: 'shape', id: s.id });
      });
      if (activeMarquee.additive) {
        const merged = [...multiSelected];
        for (const h of hits) {
          if (!merged.some(m => m.kind === h.kind && m.id === h.id)) merged.push(h);
        }
        setMultiSelected(merged);
        setChosen(merged.length === 1 ? merged[0] : null);
      } else {
        setMultiSelected(hits);
        setChosen(hits.length === 1 ? hits[0] : null);
      }
      return;
    }

    const activeDraw = drawRef.current;
    if (activeDraw && activeDraw.pointerId === e.pointerId) {
      drawRef.current = null;
      setDrawPreview(null);
      if (activeDraw.kind === 'box') {
        const smallClick = Math.abs(activeDraw.x2 - activeDraw.x1) < 1.5 && Math.abs(activeDraw.y2 - activeDraw.y1) < 1.5;
        const sx1 = clampPct(snapPct(activeDraw.x1, snapStep), 0, 84);
        const sy1 = clampPct(snapPct(activeDraw.y1, snapStep), 0, 90);
        const rect = smallClick
          ? { x: r1(sx1), y: r1(sy1), w: 16, h: 10 }
          : normalizeRectFromPoints(activeDraw.x1, activeDraw.y1, activeDraw.x2, activeDraw.y2, snapStep, 2);
        const id = crypto.randomUUID();
        const boxShape: FloorplanShape = {
          id,
          kind: 'box',
          label: 'Section',
          ...rect,
          color: 4,
          border: 'solid',
          fontSize: 'sm',
          rotate: 0,
          align: 'center',
          z: 10,
          ...currentFloorProp,
        };
        applyChange(p => ({ ...p, shapes: [...(p.shapes ?? []), boxShape] }));
        selectSingleTarget({ kind: 'shape', id });
        if (!keepToolActive) setTool('select');
      } else {
        const lineGeom = createDrawnLineGeometry(
          activeDraw.x1,
          activeDraw.y1,
          activeDraw.x2,
          activeDraw.y2,
          snapStep,
          Boolean(e.shiftKey || activeDraw.shiftKey),
        );
        const id = crypto.randomUUID();
        const lineShape: FloorplanShape = {
          id,
          kind: 'line',
          label: '',
          ...lineGeom,
          color: 4,
          lineColor: 'blue',
          lineStyle: 'solid',
          lineWidth: 2,
          z: 25,
          ...currentFloorProp,
        };
        applyChange(p => ({ ...p, shapes: [...(p.shapes ?? []), lineShape] }));
        selectSingleTarget({ kind: 'shape', id });
        if (!keepToolActive) setTool('select');
      }
      return;
    }

    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) {
      if (d.moved) {
        const base = d.basePlan;
        setDoc(curr => ({
          ...curr,
          undo: [...curr.undo.slice(-(MAX_HISTORY - 1)), base],
          redo: [],
        }));
      }
      dragRef.current = null;
    }
  }

  function abortPointerInteraction() {
    if (dragRef.current?.moved) {
      const base = dragRef.current.basePlan;
      setDoc(curr => ({
        ...curr,
        undo: [...curr.undo.slice(-(MAX_HISTORY - 1)), base],
        redo: [],
      }));
    }
    dragRef.current = null;
    drawRef.current = null;
    marqueeRef.current = null;
    setDrawPreview(null);
    setMarqueePreview(null);
  }

  const selectedZone = chosen?.kind === 'zone' ? zones.find(z => z.id === chosen.id) : undefined;
  const selectedZoneIdx = selectedZone ? zones.indexOf(selectedZone) : -1;
  const selectedZoneBox = selectedZone ? boxFor(plan, selectedZone, selectedZoneIdx, zones.length) : undefined;
  const selectedShape = chosen?.kind === 'shape' ? (plan.shapes ?? []).find(s => s.id === chosen.id) : undefined;
  const selectedDoor = chosen?.kind === 'door' ? plan.doors.find(d => d.id === chosen.id) : undefined;

  const focusedZone = zones.find(z => z.id === focusedZoneId);
  const focusedStats = focusedZone ? summary(focusedZone.id) : null;

  const sortedRenderables = useMemo(() => {
    type Item =
      | { key: string; itemKind: 'zone'; zOrder: number; zone: WarehouseZone; box: FloorplanBox }
      | { key: string; itemKind: 'shape'; zOrder: number; shape: FloorplanShape };
    const items: Item[] = [
      ...zones
        .map((zone, idx) => ({ zone, box: boxFor(plan, zone, idx, zones.length) }))
        .filter(({ box }) => belongsToFloor(box.floor, effectiveFloorId, floors))
        .map(({ zone, box }) => ({
          key: `zone:${zone.id}`,
          itemKind: 'zone' as const,
          zOrder: box.z ?? 20,
          zone,
          box,
        })),
      ...(plan.shapes ?? [])
        .filter(shape => belongsToFloor(shape.floor, effectiveFloorId, floors))
        .map(shape => ({
          key: `shape:${shape.id}`,
          itemKind: 'shape' as const,
          zOrder: shape.z ?? (shape.kind === 'label' ? 30 : shape.kind === 'line' ? 25 : 10),
          shape,
        })),
    ];
    return items.sort((a, b) => a.zOrder - b.zOrder);
  }, [plan, zones, effectiveFloorId, floors]);

  const layerRankMap = useMemo(() => {
    const map: Record<string, { rank: number; total: number }> = {};
    const total = sortedRenderables.length;
    sortedRenderables.forEach((item, idx) => {
      map[item.key] = { rank: idx + 1, total };
    });
    return map;
  }, [sortedRenderables]);

  const visibleDoors = useMemo(
    () => plan.doors.filter(d => belongsToFloor(d.floor, effectiveFloorId, floors)),
    [plan.doors, effectiveFloorId, floors],
  );

  const highlightCountByFloor = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!highlightedZones || floors.length <= 1) return counts;
    zones.forEach((z, idx) => {
      const match = highlightedZones[z.id];
      if (!match || match.units <= 0) return;
      const box = boxFor(plan, z, idx, zones.length);
      const fid = resolveEffectiveFloorId(box.floor, floors);
      counts[fid] = (counts[fid] ?? 0) + 1;
    });
    return counts;
  }, [highlightedZones, floors, zones, plan]);

  const hasHighlightSearch = !editing && !compact && Boolean(highlightedZones && Object.keys(highlightedZones).length > 0);

  type FloorplanStylePatch = Partial<{
    label: string;
    sublabel: string;
    color: number;
    fillColor: string | undefined;
    fillOpacity: number | undefined;
    textColor: string | undefined;
    bold: boolean | undefined;
    italic: boolean | undefined;
    underline: boolean | undefined;
    border: BorderStyle;
    fontSize: TextSize;
    rotate: TextRotation;
    align: 'left' | 'center';
    lineColor: LineColor;
    lineStyle: LineStyle;
    lineWidth: number;
    z: number;
  }>;

  function applyStylePatch<T extends FloorplanBox | FloorplanShape>(target: T, patch: FloorplanStylePatch): T {
    const next: Record<string, unknown> = { ...target };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) {
        delete next[k];
      } else {
        next[k] = v;
      }
    }
    return next as T;
  }

  function updateSelectedStyle(patch: FloorplanStylePatch) {
    if (!chosen) return;
    if (chosen.kind === 'zone' && selectedZone && selectedZoneBox) {
      applyChange(p => ({
        ...p,
        boxes: {
          ...p.boxes,
          [selectedZone.id]: applyStylePatch(boxFor(p, selectedZone, selectedZoneIdx, zones.length), patch),
        },
      }));
    } else if (chosen.kind === 'shape' && selectedShape) {
      applyChange(p => ({
        ...p,
        shapes: (p.shapes ?? []).map(s => (s.id === selectedShape.id ? applyStylePatch(s, patch) : s)),
      }));
    }
  }

  function handleReorderLayer(action: LayerAction) {
    if (!chosen || (chosen.kind !== 'zone' && chosen.kind !== 'shape')) return;
    const targetKey = itemSelectionKey(chosen.kind, chosen.id);
    const items: LayerOrderedItem[] = sortedRenderables.map(item =>
      item.itemKind === 'zone'
        ? { kind: 'zone', id: item.zone.id, x: item.box.x, y: item.box.y, w: item.box.w, h: item.box.h, zOrder: item.zOrder }
        : { kind: 'shape', id: item.shape.id, x: item.shape.x, y: item.shape.y, w: item.shape.w, h: item.shape.h, zOrder: item.zOrder },
    );
    const nextZMap = computeReorderedZIndices(items, targetKey, action);
    if (Object.keys(nextZMap).length === 0) return;

    applyChange(p => {
      const nextBoxes = { ...p.boxes };
      let boxesChanged = false;
      zones.forEach((z, idx) => {
        const zVal = nextZMap[itemSelectionKey('zone', z.id)];
        if (zVal === undefined) return;
        const cur = boxFor(p, z, idx, zones.length);
        if (cur.z !== zVal) {
          nextBoxes[z.id] = { ...cur, z: zVal };
          boxesChanged = true;
        }
      });
      let shapesChanged = false;
      const nextShapes = (p.shapes ?? []).map(s => {
        const zVal = nextZMap[itemSelectionKey('shape', s.id)];
        if (zVal === undefined || s.z === zVal) return s;
        shapesChanged = true;
        return { ...s, z: zVal };
      });
      if (!boxesChanged && !shapesChanged) return p;
      return {
        ...p,
        ...(boxesChanged ? { boxes: nextBoxes } : {}),
        ...(shapesChanged ? { shapes: nextShapes } : {}),
      };
    });
  }

  function handleRotateSelection(dir: 'cw' | 'ccw' | 'flip180') {
    if (!chosen || chosen.kind === 'door') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const aspectRatio = rect && rect.height > 0 ? rect.width / rect.height : 960 / canvasHeight;
    if (chosen.kind === 'zone' && selectedZone && selectedZoneBox) {
      const next = computeRotatedRect90(selectedZoneBox, selectedZoneBox.rotate, dir, aspectRatio);
      applyChange(p => ({
        ...p,
        boxes: {
          ...p.boxes,
          [selectedZone.id]: { ...boxFor(p, selectedZone, selectedZoneIdx, zones.length), ...next },
        },
      }));
    } else if (chosen.kind === 'shape' && selectedShape && selectedShape.kind !== 'line') {
      const next = computeRotatedRect90(selectedShape, selectedShape.rotate, dir, aspectRatio);
      applyChange(p => ({
        ...p,
        shapes: (p.shapes ?? []).map(s => (s.id === selectedShape.id ? { ...s, ...next } : s)),
      }));
    }
  }

  function renderLayerButtons(ariaScope: string) {
    const atBottom = !selectedLayerInfo || selectedLayerInfo.rank <= 1;
    const atTop = !selectedLayerInfo || selectedLayerInfo.rank >= selectedLayerInfo.total;
    return (
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={atBottom}
          title="Send to back (bottom layer)"
          aria-label={`Send ${ariaScope}to back`}
          onClick={() => handleReorderLayer('to-back')}
        >
          <ArrowToBottom className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={atBottom}
          title="Send backward one overlapping layer"
          onClick={() => handleReorderLayer('back-one')}
        >
          <ArrowDown className="size-3.5" />
          Back
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={atTop}
          title="Bring forward one overlapping layer"
          onClick={() => handleReorderLayer('front-one')}
        >
          <ArrowUp className="size-3.5" />
          Front
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={atTop}
          title="Bring to front (top layer)"
          aria-label={`Bring ${ariaScope}to front`}
          onClick={() => handleReorderLayer('to-front')}
        >
          <ArrowToTop className="size-3.5" />
        </Button>
      </div>
    );
  }

  function updateSelectedLinePoints(updater: (pts: LinePoints) => LinePoints) {
    if (!selectedShape || selectedShape.kind !== 'line') return;
    const nextPts = updater(getLineEndpoints(selectedShape));
    const nextGeom = shapeGeometryFromLinePoints(nextPts);
    applyChange(p => ({
      ...p,
      shapes: (p.shapes ?? []).map(s => (s.id === selectedShape.id ? { ...s, ...nextGeom } : s)),
    }));
  }

  function updateSelectedRect(field: 'x' | 'y' | 'w' | 'h', rawValue: string) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || !chosen) return;
    if (chosen.kind === 'zone' && selectedZone && selectedZoneBox) {
      const next = { ...selectedZoneBox };
      if (field === 'x') next.x = r1(clampPct(parsed, 0, 100 - next.w));
      if (field === 'y') next.y = r1(clampPct(parsed, 0, 100 - next.h));
      if (field === 'w') next.w = r1(clampPct(parsed, 2, 100 - next.x));
      if (field === 'h') next.h = r1(clampPct(parsed, 2, 100 - next.y));
      applyChange(p => ({ ...p, boxes: { ...p.boxes, [selectedZone.id]: next } }));
    } else if (chosen.kind === 'shape' && selectedShape) {
      const minW = selectedShape.kind === 'line' ? 0.5 : 2;
      const minH = selectedShape.kind === 'line' ? 0.5 : 2;
      const next = { ...selectedShape };
      if (field === 'x') next.x = r1(clampPct(parsed, 0, 100 - next.w));
      if (field === 'y') next.y = r1(clampPct(parsed, 0, 100 - next.h));
      if (field === 'w') next.w = r1(clampPct(parsed, minW, 100 - next.x));
      if (field === 'h') next.h = r1(clampPct(parsed, minH, 100 - next.y));
      applyChange(p => ({
        ...p,
        shapes: (p.shapes ?? []).map(s => (s.id === selectedShape.id ? next : s)),
      }));
    }
  }

  function handleTraceUpload(file: File | undefined) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setTraceUrl(url);
    setTraceVisible(true);
    setTraceScale(1);
    setTraceOffsetX(0);
    setTraceOffsetY(0);
    setTraceNaturalRatio(null);
  }

  function handleMatchTraceAspect() {
    if (!traceNaturalRatio || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const matchedHeight = Math.round(clampPct(rect.width / traceNaturalRatio, 300, 1600));
    applyChange(p => ({ ...p, height: matchedHeight }));
    setTraceScale(1);
    setTraceOffsetX(0);
    setTraceOffsetY(0);
    toast.success(`Canvas height matched to trace image (${matchedHeight}px)`);
  }

  function handleCopyStyle() {
    if (selectedZone && selectedZoneBox) {
      setCopiedStyle(extractBoxStyle(selectedZoneBox));
      toast.success('Copied zone style');
    } else if (selectedShape) {
      setCopiedStyle(extractBoxStyle(selectedShape));
      toast.success(selectedShape.kind === 'line' ? 'Copied line style' : 'Copied shape style');
    }
  }

  function canPasteStyleToSelection(): boolean {
    if (!copiedStyle) return false;
    if (multiSelected.length >= 2) {
      return multiSelected.some(item => {
        if (item.kind === 'zone') return copiedStyle.styleKind === 'rect';
        const sh = (plan.shapes ?? []).find(s => s.id === item.id);
        if (!sh) return false;
        return sh.kind === 'line' ? copiedStyle.styleKind === 'line' : copiedStyle.styleKind === 'rect';
      });
    }
    if (selectedZone) return copiedStyle.styleKind === 'rect';
    if (selectedShape) {
      return selectedShape.kind === 'line' ? copiedStyle.styleKind === 'line' : copiedStyle.styleKind === 'rect';
    }
    return false;
  }

  function handlePasteStyle() {
    if (!copiedStyle) return;
    const targets: SelectedRef[] =
      multiSelected.length >= 2
        ? multiSelected
        : selectedZone
          ? [{ kind: 'zone', id: selectedZone.id }]
          : selectedShape
            ? [{ kind: 'shape', id: selectedShape.id }]
            : [];
    if (!targets.length) return;
    const targetKeys = new Set(targets.map(t => itemSelectionKey(t.kind, t.id)));

    applyChange(p => {
      const nextBoxes = { ...p.boxes };
      if (copiedStyle.styleKind === 'rect') {
        zones.forEach((z, idx) => {
          if (!targetKeys.has(itemSelectionKey('zone', z.id))) return;
          const cur = boxFor(p, z, idx, zones.length);
          nextBoxes[z.id] = applyStylePatch(cur, {
            color: copiedStyle.color,
            fillColor: copiedStyle.fillColor,
            fillOpacity: copiedStyle.fillOpacity,
            textColor: copiedStyle.textColor,
            bold: copiedStyle.bold,
            italic: copiedStyle.italic,
            underline: copiedStyle.underline,
            border: copiedStyle.border,
            fontSize: copiedStyle.fontSize,
            rotate: copiedStyle.rotate,
            align: copiedStyle.align,
          });
        });
      }
      const nextShapes = (p.shapes ?? []).map(s => {
        if (!targetKeys.has(itemSelectionKey('shape', s.id))) return s;
        if (s.kind === 'line' && copiedStyle.styleKind === 'line') {
          return {
            ...s,
            lineColor: copiedStyle.lineColor,
            lineStyle: copiedStyle.lineStyle,
            lineWidth: copiedStyle.lineWidth,
          };
        }
        if (s.kind !== 'line' && copiedStyle.styleKind === 'rect') {
          return applyStylePatch(s, {
            color: copiedStyle.color,
            fillColor: copiedStyle.fillColor,
            fillOpacity: copiedStyle.fillOpacity,
            textColor: copiedStyle.textColor,
            bold: copiedStyle.bold,
            italic: copiedStyle.italic,
            underline: copiedStyle.underline,
            border: s.kind === 'label' && copiedStyle.border === 'none' ? 'none' : copiedStyle.border,
            fontSize: copiedStyle.fontSize,
            rotate: copiedStyle.rotate,
            align: copiedStyle.align,
          });
        }
        return s;
      });
      return { ...p, boxes: nextBoxes, shapes: nextShapes };
    });
    toast.success('Style applied');
  }

  function commitInlineEdit(shapeId: string) {
    setEditingInlineId(null);
    const current = (plan.shapes ?? []).find(s => s.id === shapeId);
    if (!current || current.label === inlineDraft) return;
    applyChange(p => ({
      ...p,
      shapes: (p.shapes ?? []).map(s => (s.id === shapeId ? { ...s, label: inlineDraft } : s)),
    }));
  }

  function handleExportJson() {
    try {
      const json = JSON.stringify(plan, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `warehouse-floorplan-${warehouseId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Exported floorplan JSON');
    } catch {
      toast.error('Unable to export floorplan JSON.');
    }
  }

  async function handleImportJson(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = normalizeLoadedPlan(parseFloorplanImport(text));
      applyChange(() => imported);
      selectSingleTarget(null);
      if (imported.floors?.length) setActiveFloorId(imported.floors[0].id);
      toast.success('Imported floorplan JSON — click Save Layout to persist.');
    } catch (e) {
      toast.error((e as Error).message || 'Unable to import floorplan JSON.');
    }
  }

  function saveFloorModal() {
    const trimmed = floorNameInput.trim();
    if (!trimmed || trimmed.length > 60 || !floorModal) return;
    if (floorModal.mode === 'add') {
      const newFloorId = crypto.randomUUID();
      applyChange(p => {
        const existingFloors = p.floors ?? [];
        if (existingFloors.length === 0) {
          const firstId = crypto.randomUUID();
          const migratedBoxes = Object.fromEntries(
            Object.entries(p.boxes).map(([zid, box]) => [zid, { ...box, floor: box.floor ?? firstId }]),
          );
          const migratedShapes = (p.shapes ?? []).map(s => ({ ...s, floor: s.floor ?? firstId }));
          const migratedDoors = p.doors.map(d => ({ ...d, floor: d.floor ?? firstId }));
          return {
            ...p,
            floors: [
              { id: firstId, name: 'Building 1 / Ground' },
              { id: newFloorId, name: trimmed },
            ],
            boxes: migratedBoxes,
            shapes: migratedShapes,
            doors: migratedDoors,
          };
        }
        return {
          ...p,
          floors: [...existingFloors, { id: newFloorId, name: trimmed }],
        };
      });
      setActiveFloorId(newFloorId);
      selectSingleTarget(null);
    } else if (floorModal.mode === 'rename' && floorModal.floorId) {
      applyChange(p => ({
        ...p,
        floors: (p.floors ?? []).map(f => (f.id === floorModal.floorId ? { ...f, name: trimmed } : f)),
      }));
    }
    setFloorModal(null);
  }

  function removeFloorTab(floorIdToRemove: string) {
    if (floors.length <= 1) return;
    const remaining = floors.filter(f => f.id !== floorIdToRemove);
    const fallbackFloorId = remaining[0].id;
    applyChange(p => {
      const remap = (fid?: string) => (fid === floorIdToRemove ? fallbackFloorId : fid);
      const nextBoxes = Object.fromEntries(
        Object.entries(p.boxes).map(([zid, box]) => [zid, { ...box, floor: remap(box.floor) }]),
      );
      const nextShapes = (p.shapes ?? []).map(s => ({ ...s, floor: remap(s.floor) }));
      const nextDoors = p.doors.map(d => ({ ...d, floor: remap(d.floor) }));
      if (remaining.length <= 1) {
        return {
          ...p,
          floors: undefined,
          boxes: Object.fromEntries(Object.entries(nextBoxes).map(([zid, { floor: _f, ...rest }]) => [zid, rest])),
          shapes: nextShapes.map(({ floor: _f, ...rest }) => rest),
          doors: nextDoors.map(({ floor: _f, ...rest }) => rest),
        };
      }
      return { ...p, floors: remaining, boxes: nextBoxes, shapes: nextShapes, doors: nextDoors };
    });
    if (activeFloorId === floorIdToRemove) setActiveFloorId(remaining.length > 1 ? fallbackFloorId : '');
    toast.success('Merged items into the primary tab');
  }

  function moveSelectionToFloor(targetFloorId: string) {
    applyChange(p => {
      const selectedKeys = new Set(
        multiSelected.length >= 2
          ? multiSelected.map(i => itemSelectionKey(i.kind, i.id))
          : chosen && (chosen.kind === 'zone' || chosen.kind === 'shape')
            ? [itemSelectionKey(chosen.kind, chosen.id)]
            : [],
      );
      const nextBoxes = { ...p.boxes };
      zones.forEach((z, idx) => {
        if (selectedKeys.has(itemSelectionKey('zone', z.id))) {
          const cur = boxFor(p, z, idx, zones.length);
          nextBoxes[z.id] = { ...cur, floor: targetFloorId };
        }
      });
      const nextShapes = (p.shapes ?? []).map(s =>
        selectedKeys.has(itemSelectionKey('shape', s.id)) ? { ...s, floor: targetFloorId } : s,
      );
      const nextDoors = p.doors.map(d =>
        chosen?.kind === 'door' && chosen.id === d.id ? { ...d, floor: targetFloorId } : d,
      );
      return { ...p, boxes: nextBoxes, shapes: nextShapes, doors: nextDoors };
    });
    const destName = floors.find(f => f.id === targetFloorId)?.name ?? 'floor';
    toast.success(`Moved selection to ${destName}`);
  }

  function discardEditsAndExit() {
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch {
      // ignore cleanup
    }
    setDoc({ plan: saved.current, undo: [], redo: [] });
    setEditing(false);
    setTool('select');
    selectSingleTarget(null);
    setEditingInlineId(null);
    setCancelConfirmOpen(false);
  }

  const cachedMeta = useMemo(() => readCachedFloorplanMeta(storageKey), [storageKey]);
  const canvasHeight = compact
    ? 168
    : loading
      ? (cachedMeta?.height ?? plan.height ?? INITIAL_FLOORPLAN.height ?? 520)
      : (plan.height ?? INITIAL_FLOORPLAN.height ?? 520);
  const gridStep = snapStep >= 2 ? snapStep : 5;
  const gridBackground =
    editable && showGrid && snapStep > 0
      ? {
          backgroundImage:
            'linear-gradient(to right, rgba(120,120,120,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(120,120,120,0.12) 1px, transparent 1px)',
          backgroundSize: `${gridStep}% ${gridStep}%`,
        }
      : undefined;

  if (loading) {
    return (
      <div className="space-y-4">
        {!compact && canEdit && <div className="h-9 w-28 rounded-md bg-muted/50" />}
        {!compact && cachedMeta?.hasTabs && <div className="h-8 w-64 rounded-md bg-muted/40" />}
        <div className={compact ? 'p-2' : 'p-4'}>
          <div
            style={{ height: `${canvasHeight}px` }}
            className="flex items-center justify-center border-[3px] border-foreground/20 bg-muted/20 text-sm text-muted-foreground"
          >
            Loading floorplan...
          </div>
        </div>
        {!compact && <div className="h-4" />}
      </div>
    );
  }
  if (error) return <p role="alert" className="p-6 text-sm text-destructive">Unable to load floorplan: {error}</p>;

  const hasContent = sortedRenderables.length > 0 || visibleDoors.length > 0;
  const hasAnyMapContent = zones.length > 0 || (plan.shapes?.length ?? 0) > 0 || Object.keys(plan.boxes).length > 0;
  const styleTarget =
    chosen?.kind === 'zone' && selectedZoneBox
      ? {
          isLine: false,
          color: selectedZoneBox.color,
          fillColor: selectedZoneBox.fillColor,
          fillOpacity: selectedZoneBox.fillOpacity,
          textColor: selectedZoneBox.textColor,
          bold: selectedZoneBox.bold,
          italic: selectedZoneBox.italic,
          underline: selectedZoneBox.underline,
          border: selectedZoneBox.border ?? 'solid',
          fontSize: selectedZoneBox.fontSize ?? 'sm',
          rotate: selectedZoneBox.rotate ?? 0,
          align: selectedZoneBox.align ?? 'left',
          x: selectedZoneBox.x,
          y: selectedZoneBox.y,
          w: selectedZoneBox.w,
          h: selectedZoneBox.h,
        }
      : chosen?.kind === 'shape' && selectedShape
        ? {
            isLine: selectedShape.kind === 'line',
            color: selectedShape.color,
            fillColor: selectedShape.fillColor,
            fillOpacity: selectedShape.fillOpacity,
            textColor: selectedShape.textColor,
            bold: selectedShape.bold,
            italic: selectedShape.italic,
            underline: selectedShape.underline,
            border: selectedShape.border ?? (selectedShape.kind === 'label' ? 'none' : 'solid'),
            fontSize: selectedShape.fontSize ?? 'sm',
            rotate: selectedShape.rotate ?? 0,
            align: selectedShape.align ?? 'center',
            x: selectedShape.x,
            y: selectedShape.y,
            w: selectedShape.w,
            h: selectedShape.h,
          }
        : null;

  const selectedLayerInfo =
    chosen && (chosen.kind === 'zone' || chosen.kind === 'shape')
      ? layerRankMap[itemSelectionKey(chosen.kind, chosen.id)]
      : undefined;

  return (
    <div className="space-y-4">
      {!compact && canEdit && pendingDraft && !editing && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs"
        >
          <span className="font-medium text-foreground">
            Recovered an unsaved floorplan draft from an earlier edit session.
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                setDoc({ plan: pendingDraft, undo: [], redo: [] });
                setPendingDraft(null);
                setEditing(true);
                setTool('select');
                if (pendingDraft.floors?.length) setActiveFloorId(pendingDraft.floors[0].id);
                toast.success('Restored unsaved draft');
              }}
            >
              Restore Draft
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                try {
                  window.localStorage.removeItem(draftStorageKey);
                } catch {
                  // ignore
                }
                setPendingDraft(null);
              }}
            >
              Discard Draft
            </Button>
          </div>
        </div>
      )}

      {!compact && canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {!editing ? (
            <Button
              variant="outline"
              onClick={() => {
                setEditing(true);
                setTool('select');
                if (focusedZoneId) selectSingleTarget({ kind: 'zone', id: focusedZoneId });
              }}
            >
              <Pencil className="size-4" />
              Edit Layout
            </Button>
          ) : (
            <>
              <Button disabled={saving} onClick={save}>
                <Save className="size-4" />
                {saving ? 'Saving...' : 'Save Layout'}
              </Button>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => {
                  if (isDirty) setCancelConfirmOpen(true);
                  else discardEditsAndExit();
                }}
              >
                Cancel
              </Button>
              <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
              <Button
                size="sm"
                variant={tool === 'select' ? 'secondary' : 'outline'}
                disabled={saving}
                onClick={() => setTool('select')}
              >
                <MousePointer className="size-4" />
                Select
              </Button>
              <Button
                size="sm"
                variant={tool === 'draw-box' ? 'secondary' : 'outline'}
                disabled={saving}
                onClick={() => setTool(t => (t === 'draw-box' ? 'select' : 'draw-box'))}
              >
                <Square className="size-4" />
                Draw Box
              </Button>
              <Button
                size="sm"
                variant={tool === 'draw-line' ? 'secondary' : 'outline'}
                disabled={saving}
                onClick={() => setTool(t => (t === 'draw-line' ? 'select' : 'draw-line'))}
              >
                <Minus className="size-4" />
                Draw Line
              </Button>
              <Button
                size="sm"
                variant={keepToolActive ? 'secondary' : 'outline'}
                disabled={saving}
                title="Keep Draw Box / Draw Line active after drawing instead of switching back to Select"
                onClick={() => setKeepToolActive(k => !k)}
              >
                {keepToolActive ? 'Sticky Tool: On' : 'Sticky Tool'}
              </Button>
              <Button size="sm" variant="outline" disabled={saving} onClick={addLabel}>
                <TextT className="size-4" />
                + Text Label
              </Button>
              <Button size="sm" variant="outline" disabled={saving} onClick={addDoor}>
                <DoorOpen className="size-4" />
                + Door
              </Button>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => onZoneAction('add')}>
                <Plus className="size-4" />
                + Add Zone
              </Button>
              <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
              <Button
                size="sm"
                variant="outline"
                disabled={saving || doc.undo.length === 0}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                onClick={undo}
              >
                <Undo2 className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saving || doc.redo.length === 0}
                title="Redo (Ctrl+Y)"
                aria-label="Redo"
                onClick={redo}
              >
                <Redo2 className="size-4" />
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={e => {
                  void handleImportJson(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Button size="sm" variant="outline" disabled={saving} title="Export floorplan JSON backup" onClick={handleExportJson}>
                <Download className="size-3.5" />
                Export
              </Button>
              <Button size="sm" variant="outline" disabled={saving} title="Import floorplan JSON backup" onClick={() => importInputRef.current?.click()}>
                <Upload className="size-3.5" />
                Import
              </Button>
              {onClearAllZones && hasAnyMapContent && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={onClearAllZones}
                >
                  <Eraser className="size-4" />
                  Clear Map
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {!compact && (floors.length > 1 || editable) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {floors.length > 1 && (
            <>
              <span className="mr-1 text-xs font-medium text-muted-foreground">Floor / Map:</span>
              {floors.map(f => {
                const isTabActive = f.id === effectiveFloorId;
                const matchCount = highlightCountByFloor[f.id] ?? 0;
                return (
                  <div key={f.id} className="flex items-center gap-0.5">
                    <Button
                      size="sm"
                      variant={isTabActive ? 'default' : 'outline'}
                      onClick={() => {
                        setActiveFloorId(f.id);
                        selectSingleTarget(null);
                      }}
                    >
                      {f.name}
                      {matchCount > 0 && (
                        <span className="ml-1.5 rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-bold text-foreground">
                          {matchCount}
                        </span>
                      )}
                    </Button>
                    {editable && isTabActive && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-1.5 text-xs"
                        title="Rename floor tab"
                        onClick={() => {
                          setFloorNameInput(f.name);
                          setFloorModal({ mode: 'rename', floorId: f.id });
                        }}
                      >
                        <Pencil className="size-3" />
                      </Button>
                    )}
                    {editable && isTabActive && floors.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-1.5 text-xs text-destructive"
                        title="Remove tab (merges its items into primary tab)"
                        onClick={() => removeFloorTab(f.id)}
                      >
                        <X className="size-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </>
          )}
          {editable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFloorNameInput(floors.length === 0 ? '6001-E / 2nd Floor' : `Floor ${floors.length + 1}`);
                setFloorModal({ mode: 'add' });
              }}
            >
              <Plus className="size-3.5" />
              {floors.length === 0 ? '+ Add Floor / Building Tab' : '+ Tab'}
            </Button>
          )}
        </div>
      )}

      {editable && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground">
              {tool === 'draw-box'
                ? 'Drag anywhere on the canvas to draw a box (minimum 2% × 2%). Press Esc to switch back to Select.'
                : tool === 'draw-line'
                  ? 'Drag in any direction to draw a line (hold Shift to snap 45°/90°). Press Esc to cancel.'
                  : 'Click an item, Shift+Click or drag empty canvas for multi-select, double-click labels/boxes to edit text, or drag line ends freely.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-muted-foreground">
                Snap
                <select
                  aria-label="Snap grid step"
                  className="rounded border bg-background px-1.5 py-1 text-foreground"
                  value={snapStep}
                  onChange={e => setSnapStep(Number(e.target.value) as 0 | 1 | 2 | 5)}
                >
                  <option value={0}>Free</option>
                  <option value={1}>1%</option>
                  <option value={2}>2%</option>
                  <option value={5}>5%</option>
                </select>
              </label>
              <Button
                size="sm"
                variant={showGrid ? 'secondary' : 'outline'}
                disabled={snapStep === 0}
                title="Toggle alignment grid"
                onClick={() => setShowGrid(g => !g)}
              >
                <Grid className="size-3.5" />
                Grid
              </Button>
              <Button
                size="sm"
                variant={onionView ? 'secondary' : 'outline'}
                aria-pressed={onionView}
                title="Translucent onion-skin layers while editing so stacked boxes and zones show through"
                onClick={() => setOnionView(o => !o)}
              >
                <LayersIcon className="size-3.5" />
                Onion
              </Button>
              <label className="flex items-center gap-1.5 text-muted-foreground">
                Canvas
                <select
                  aria-label="Canvas height preset"
                  className="rounded border bg-background px-1.5 py-1 text-foreground"
                  value={currentCanvasHeight}
                  onChange={e => applyChange(p => ({ ...p, height: Number(e.target.value) }))}
                >
                  {FLOORPLAN_HEIGHT_PRESETS.map(preset => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                  {(!isCurrentPresetHeight || lastCustomHeight !== null) && (
                    <option value={isCurrentPresetHeight ? lastCustomHeight! : currentCanvasHeight}>
                      Custom ({isCurrentPresetHeight ? lastCustomHeight : currentCanvasHeight}px)
                    </option>
                  )}
                </select>
              </label>
              <input
                ref={traceInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  handleTraceUpload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {!traceUrl ? (
                <Button size="sm" variant="outline" onClick={() => traceInputRef.current?.click()}>
                  <Upload className="size-3.5" />
                  Trace Screenshot
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded border bg-background px-2 py-1">
                  <ImageIcon className="size-3.5 text-muted-foreground" />
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    Opacity
                    <input
                      aria-label="Trace overlay opacity"
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.05}
                      value={traceOpacity}
                      onChange={e => setTraceOpacity(Number(e.target.value))}
                      className="w-14"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    Zoom
                    <input
                      aria-label="Trace overlay zoom"
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.05}
                      value={traceScale}
                      onChange={e => setTraceScale(Number(e.target.value))}
                      className="w-14"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    X
                    <input
                      aria-label="Trace horizontal offset"
                      type="range"
                      min={-50}
                      max={50}
                      step={1}
                      value={traceOffsetX}
                      onChange={e => setTraceOffsetX(Number(e.target.value))}
                      className="w-12"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    Y
                    <input
                      aria-label="Trace vertical offset"
                      type="range"
                      min={-50}
                      max={50}
                      step={1}
                      value={traceOffsetY}
                      onChange={e => setTraceOffsetY(Number(e.target.value))}
                      className="w-12"
                    />
                  </label>
                  {traceNaturalRatio && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[11px]"
                      title="Match canvas height to the uploaded trace image aspect ratio"
                      onClick={handleMatchTraceAspect}
                    >
                      Match Ratio
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px]"
                    title="Reset trace zoom and offset"
                    onClick={() => {
                      setTraceScale(1);
                      setTraceOffsetX(0);
                      setTraceOffsetY(0);
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5"
                    aria-label={traceVisible ? 'Hide trace guide' : 'Show trace guide'}
                    onClick={() => setTraceVisible(v => !v)}
                  >
                    {traceVisible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-destructive"
                    aria-label="Remove trace guide"
                    onClick={() => setTraceUrl(null)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {multiSelected.length >= 2 && (
            <div className="space-y-2 border-t border-border/60 pt-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-gold/25 px-2 py-0.5 font-semibold text-foreground">
                    {multiSelected.length} items selected
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Drag any selected item or use Arrow keys to move together
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {canPasteStyleToSelection() && (
                    <Button size="sm" variant="outline" onClick={handlePasteStyle}>
                      Paste Style
                    </Button>
                  )}
                  {multiSelected.some(i => i.kind === 'shape') && (
                    <Button size="sm" variant="outline" onClick={handleDuplicateSelection}>
                      <Copy className="size-3.5" />
                      Duplicate Shapes
                    </Button>
                  )}
                  {multiSelected.some(i => i.kind === 'shape') && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={removeSelected}
                    >
                      <Trash2 className="size-3.5" />
                      Delete Shapes
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => selectSingleTarget(null)}>
                    Clear
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-medium text-muted-foreground">Align:</span>
                {([
                  ['left', 'Left'],
                  ['center-h', 'Center H'],
                  ['right', 'Right'],
                  ['top', 'Top'],
                  ['middle-v', 'Middle V'],
                  ['bottom', 'Bottom'],
                ] as const).map(([mode, label]) => (
                  <Button key={mode} size="sm" variant="outline" onClick={() => handleAlignSelection(mode)}>
                    {label}
                  </Button>
                ))}
                {multiSelected.length >= 3 && (
                  <>
                    <span className="mx-1 text-[11px] font-medium text-muted-foreground">Distribute:</span>
                    <Button size="sm" variant="outline" onClick={() => handleDistributeSelection('h')}>
                      Space H
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDistributeSelection('v')}>
                      Space V
                    </Button>
                  </>
                )}
                <span className="mx-1 text-[11px] font-medium text-muted-foreground">Match:</span>
                <Button size="sm" variant="outline" onClick={() => handleMatchSelectionSize('w')}>
                  Same W
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleMatchSelectionSize('h')}>
                  Same H
                </Button>
                {floors.length > 1 && (
                  <label className="ml-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    Floor
                    <select
                      aria-label="Move selection to floor"
                      className="rounded border bg-background px-1.5 py-1 text-foreground"
                      value={effectiveFloorId}
                      onChange={e => moveSelectionToFloor(e.target.value)}
                    >
                      {floors.map(f => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          )}

          {multiSelected.length < 2 && chosen && (
            <div className="space-y-2.5 border-t border-border/60 pt-2.5">
              {selectedZone && selectedZoneBox && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-gold/20 px-2 py-0.5 font-semibold text-foreground">Inventory Zone</span>
                    <span className="font-semibold text-foreground">{selectedZone.name}</span>
                    <Button size="sm" variant="outline" onClick={() => onZoneAction('rename', selectedZone)}>
                      Rename
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleCopyStyle}>
                      Copy Style
                    </Button>
                    {canPasteStyleToSelection() && (
                      <Button size="sm" variant="outline" onClick={handlePasteStyle}>
                        Paste Style
                      </Button>
                    )}
                    {floors.length > 1 && (
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        Floor
                        <select
                          aria-label="Move zone to floor"
                          className="rounded border bg-background px-1.5 py-1 text-foreground"
                          value={resolveEffectiveFloorId(selectedZoneBox.floor, floors)}
                          onChange={e => moveSelectionToFloor(e.target.value)}
                        >
                          {floors.map(f => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onZoneAction('delete', selectedZone)}
                    >
                      <Trash2 className="size-3.5" />
                      Delete Zone
                    </Button>
                  </div>
                  {renderLayerButtons('zone ')}
                </div>
              )}

              {selectedShape && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-foreground/10 px-2 py-0.5 font-semibold text-foreground">
                      {selectedShape.kind === 'box' ? 'Box' : selectedShape.kind === 'label' ? 'Text Label' : 'Line'}
                    </span>
                    {selectedShape.kind !== 'line' && (
                      <select
                        aria-label="Shape kind"
                        className="rounded border bg-background px-2 py-1 text-foreground"
                        value={selectedShape.kind}
                        onChange={e => {
                          const nextKind = e.target.value as 'box' | 'label';
                          applyChange(p => ({
                            ...p,
                            shapes: (p.shapes ?? []).map(s =>
                              s.id === selectedShape.id
                                ? { ...s, kind: nextKind, border: nextKind === 'label' ? 'none' : 'solid' }
                                : s,
                            ),
                          }));
                        }}
                      >
                        <option value="box">Box</option>
                        <option value="label">Floating Label</option>
                      </select>
                    )}
                    {selectedShape.kind === 'line' && (
                      <>
                        <label className="flex items-center gap-1.5">
                          Style
                          <select
                            aria-label="Line style"
                            className="rounded border bg-background px-2 py-1 text-foreground"
                            value={selectedShape.lineStyle ?? 'solid'}
                            onChange={e => updateSelectedStyle({ lineStyle: e.target.value as LineStyle })}
                          >
                            {LINE_STYLE_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5">
                          Thickness
                          <select
                            aria-label="Line thickness"
                            className="rounded border bg-background px-2 py-1 text-foreground"
                            value={resolveLineWidth(selectedShape.lineWidth)}
                            onChange={e => updateSelectedStyle({ lineWidth: Number(e.target.value) })}
                          >
                            {!LINE_THICKNESS_OPTIONS.some(w => w === resolveLineWidth(selectedShape.lineWidth)) && (
                              <option value={resolveLineWidth(selectedShape.lineWidth)}>
                                {resolveLineWidth(selectedShape.lineWidth)}px
                              </option>
                            )}
                            {LINE_THICKNESS_OPTIONS.map(w => (
                              <option key={w} value={w}>
                                {w}px
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5">
                          Color
                          <select
                            aria-label="Line color"
                            className="rounded border bg-background px-2 py-1 text-foreground"
                            value={selectedShape.lineColor ?? 'dark'}
                            onChange={e => updateSelectedStyle({ lineColor: e.target.value as LineColor })}
                          >
                            {LINE_COLOR_OPTIONS.map(c => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedShape.kind === 'box' && (
                      <Button
                        size="sm"
                        variant="default"
                        title="Turn this drawn box into a real clickable inventory zone"
                        onClick={() => onZoneAction('add', undefined, selectedShape)}
                      >
                        <Package className="size-3.5" />
                        Convert to Zone
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={handleCopyStyle}>
                      Copy Style
                    </Button>
                    {canPasteStyleToSelection() && (
                      <Button size="sm" variant="outline" onClick={handlePasteStyle}>
                        Paste Style
                      </Button>
                    )}
                    {floors.length > 1 && (
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        Floor
                        <select
                          aria-label="Move shape to floor"
                          className="rounded border bg-background px-1.5 py-1 text-foreground"
                          value={resolveEffectiveFloorId(selectedShape.floor, floors)}
                          onChange={e => moveSelectionToFloor(e.target.value)}
                        >
                          {floors.map(f => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {renderLayerButtons('shape ')}
                    <Button size="sm" variant="outline" onClick={handleDuplicateSelection}>
                      <Copy className="size-3.5" />
                      Duplicate
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={removeSelected}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              )}

              {selectedDoor && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded bg-foreground/10 px-2 py-0.5 font-semibold text-foreground">Entrance / Door</span>
                  <label className="flex items-center gap-1.5">
                    Edge
                    <select
                      className="rounded border bg-background px-2 py-1 text-foreground"
                      value={selectedDoor.edge}
                      onChange={e =>
                        applyChange(p => ({
                          ...p,
                          doors: p.doors.map(d => (d.id === selectedDoor.id ? { ...d, edge: e.target.value as DoorEdge } : d)),
                        }))
                      }
                    >
                      {(['top', 'bottom', 'left', 'right'] as DoorEdge[]).map(edge => (
                        <option key={edge} value={edge}>
                          {edge[0].toUpperCase() + edge.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">
                    Offset %
                    <input
                      type="number"
                      min={2}
                      max={98}
                      step={1}
                      className="w-16 rounded border bg-background px-2 py-1 text-foreground"
                      value={selectedDoor.offset}
                      onChange={e => {
                        const nextOffset = Number(e.target.value);
                        if (!Number.isFinite(nextOffset)) return;
                        applyChange(p => ({
                          ...p,
                          doors: p.doors.map(d =>
                            d.id === selectedDoor.id ? { ...d, offset: r1(clampPct(nextOffset, 2, 98)) } : d,
                          ),
                        }));
                      }}
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={removeSelected}
                  >
                    <Trash2 className="size-3.5" />
                    Delete Entrance
                  </Button>
                </div>
              )}

              {styleTarget && (
                <div className="flex flex-wrap items-start gap-3">
                  {!styleTarget.isLine && (
                    <>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          {selectedZone ? 'Sublabel / Rack Items (multi-line)' : 'Label Text (multi-line)'}
                        </span>
                        <textarea
                          rows={2}
                          placeholder={selectedZone ? 'e.g. Tubes\nBikes' : 'e.g. Show room\nGround floor'}
                          className="w-48 rounded border bg-background px-2 py-1 text-xs text-foreground"
                          value={selectedZone ? (selectedZoneBox?.sublabel ?? '') : (selectedShape?.label ?? '')}
                          onChange={e =>
                            updateSelectedStyle(selectedZone ? { sublabel: e.target.value } : { label: e.target.value })
                          }
                        />
                      </label>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">Fill Color</span>
                        <FloorplanColorPicker
                          mode="fill"
                          ariaLabel="Element fill color"
                          presetIndex={styleTarget.color}
                          fillColor={styleTarget.fillColor}
                          fillOpacity={styleTarget.fillOpacity}
                          onSelectFillPreset={colorIdx =>
                            updateSelectedStyle({ color: colorIdx, fillColor: undefined, fillOpacity: undefined })
                          }
                          onChangeCustomFill={(nextHex, nextOpacity) =>
                            updateSelectedStyle({ fillColor: nextHex, fillOpacity: nextOpacity })
                          }
                        />
                      </div>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">Border</span>
                        <select
                          aria-label="Element border style"
                          className="h-7.5 rounded border bg-background px-2 py-1 text-foreground"
                          value={styleTarget.border}
                          onChange={e => updateSelectedStyle({ border: e.target.value as BorderStyle })}
                        >
                          <option value="solid">Solid</option>
                          <option value="dashed">Dashed</option>
                          <option value="none">None</option>
                        </select>
                      </label>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">Text Color</span>
                        <FloorplanColorPicker
                          mode="text"
                          ariaLabel="Text color"
                          textColor={styleTarget.textColor}
                          onChangeTextColor={nextHex => updateSelectedStyle({ textColor: nextHex })}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">Format</span>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant={styleTarget.bold ? 'secondary' : 'outline'}
                            aria-pressed={Boolean(styleTarget.bold)}
                            aria-label="Bold"
                            title="Bold"
                            className="size-7.5 px-0"
                            onClick={() => updateSelectedStyle({ bold: !styleTarget.bold })}
                          >
                            <BoldIcon className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant={styleTarget.italic ? 'secondary' : 'outline'}
                            aria-pressed={Boolean(styleTarget.italic)}
                            aria-label="Italic"
                            title="Italic"
                            className="size-7.5 px-0"
                            onClick={() => updateSelectedStyle({ italic: !styleTarget.italic })}
                          >
                            <ItalicIcon className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant={styleTarget.underline ? 'secondary' : 'outline'}
                            aria-pressed={Boolean(styleTarget.underline)}
                            aria-label="Underline"
                            title="Underline"
                            className="size-7.5 px-0"
                            onClick={() => updateSelectedStyle({ underline: !styleTarget.underline })}
                          >
                            <UnderlineIcon className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">Text Size</span>
                        <select
                          aria-label="Text size"
                          className="h-7.5 rounded border bg-background px-2 py-1 text-foreground"
                          value={styleTarget.fontSize}
                          onChange={e => updateSelectedStyle({ fontSize: e.target.value as TextSize })}
                        >
                          <option value="xs">XS</option>
                          <option value="sm">S</option>
                          <option value="base">M</option>
                          <option value="lg">L</option>
                        </select>
                      </label>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">Rotate</span>
                        <div className="flex items-center gap-1">
                          <select
                            aria-label="Text rotation"
                            className="h-7.5 rounded border bg-background px-2 py-1 text-foreground"
                            value={styleTarget.rotate}
                            onChange={e => updateSelectedStyle({ rotate: Number(e.target.value) as TextRotation })}
                          >
                            <option value={0}>0° Horizontal</option>
                            <option value={-90}>-90° Vertical ↑</option>
                            <option value={90}>90° Vertical ↓</option>
                            <option value={180}>180° Upside Down</option>
                          </select>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label="Rotate box 90 degrees"
                            title="Rotate box / zone 90° clockwise (swaps width & height)"
                            className="h-7.5 gap-1 px-2"
                            onClick={() => handleRotateSelection('cw')}
                          >
                            <Redo2 className="size-3.5" />
                            <span>90°</span>
                          </Button>
                        </div>
                      </div>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium text-muted-foreground">Align</span>
                        <select
                          aria-label="Text alignment"
                          className="h-7.5 rounded border bg-background px-2 py-1 text-foreground"
                          value={styleTarget.align}
                          onChange={e => updateSelectedStyle({ align: e.target.value as 'left' | 'center' })}
                        >
                          <option value="center">Center</option>
                          <option value="left">Left</option>
                        </select>
                      </label>
                    </>
                  )}
                  {!styleTarget.isLine ? (
                    <div className="flex flex-wrap items-end gap-1.5">
                      {(['x', 'y', 'w', 'h'] as const).map(dim => (
                        <label key={dim} className="flex flex-col gap-1">
                          <span className="text-[11px] font-medium uppercase text-muted-foreground">{dim}%</span>
                          <input
                            type="number"
                            step={0.5}
                            min={0}
                            max={100}
                            className="w-15 rounded border bg-background px-1.5 py-1 text-foreground"
                            value={styleTarget[dim]}
                            onChange={e => updateSelectedRect(dim, e.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    selectedShape &&
                    (() => {
                      const pts = getLineEndpoints(selectedShape);
                      const metrics = getLineMetrics(pts);
                      return (
                        <div className="flex flex-wrap items-end gap-2">
                          <LineNumberInput
                            label="Start X1%"
                            value={pts.x1}
                            min={0}
                            max={100}
                            onCommit={v => updateSelectedLinePoints(p => updateLineEndpoint(p, 'p1', v, p.y1, 0, false))}
                          />
                          <LineNumberInput
                            label="Start Y1%"
                            value={pts.y1}
                            min={0}
                            max={100}
                            onCommit={v => updateSelectedLinePoints(p => updateLineEndpoint(p, 'p1', p.x1, v, 0, false))}
                          />
                          <LineNumberInput
                            label="End X2%"
                            value={pts.x2}
                            min={0}
                            max={100}
                            onCommit={v => updateSelectedLinePoints(p => updateLineEndpoint(p, 'p2', v, p.y2, 0, false))}
                          />
                          <LineNumberInput
                            label="End Y2%"
                            value={pts.y2}
                            min={0}
                            max={100}
                            onCommit={v => updateSelectedLinePoints(p => updateLineEndpoint(p, 'p2', p.x2, v, 0, false))}
                          />
                          <LineNumberInput
                            label="Length %"
                            value={metrics.length}
                            min={0.5}
                            max={142}
                            onCommit={v => updateSelectedLinePoints(p => resizeLineLength(p, v))}
                          />
                          <LineNumberInput
                            label="Angle °"
                            value={metrics.angleDeg}
                            min={-180}
                            max={180}
                            step={1}
                            onCommit={v => updateSelectedLinePoints(p => rotateLineAngle(p, v))}
                          />
                          <div className="flex flex-wrap items-center gap-1 pb-0.5">
                            <Button
                              size="sm"
                              variant="outline"
                              title="Make line horizontal"
                              onClick={() => updateSelectedLinePoints(p => straightenLine(p, 'h'))}
                            >
                              Horizontal
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              title="Make line vertical"
                              onClick={() => updateSelectedLinePoints(p => straightenLine(p, 'v'))}
                            >
                              Vertical
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              title="Swap start and end points"
                              onClick={() => updateSelectedLinePoints(p => straightenLine(p, 'swap'))}
                            >
                              Swap Ends
                            </Button>
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!compact && !editing && focusedZone && focusedStats && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3.5 py-2.5 text-sm">
          <div className="min-w-0">
            <span className="font-semibold text-foreground">{focusedZone.name}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {focusedStats.units.toLocaleString()} units · {focusedStats.products} products
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="default" onClick={() => onSelect(focusedZone.id)}>
              <Package className="size-3.5" />
              View Zone Inventory
            </Button>
            {canEdit && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(true);
                    setChosen({ kind: 'zone', id: focusedZone.id });
                  }}
                >
                  <Pencil className="size-3.5" />
                  Edit Position
                </Button>
                <Button size="sm" variant="outline" onClick={() => onZoneAction('rename', focusedZone)}>
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onZoneAction('delete', focusedZone)}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" aria-label="Clear selected zone" onClick={() => setFocusedZoneId('')}>
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className={compact ? 'p-2' : 'overflow-x-auto p-4'}>
        <div
          ref={canvasRef}
          aria-label="Warehouse floorplan, not to scale"
          className={`relative border-[3px] border-foreground/45 bg-muted/15 ${
            compact ? '' : 'min-w-130'
          } ${editable && tool !== 'select' ? 'cursor-crosshair select-none touch-none' : ''}`}
          style={{ height: `${canvasHeight}px`, ...gridBackground }}
          onClick={e => {
            if (e.target === e.currentTarget && !compact && !editing) setFocusedZoneId('');
          }}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={finishPointerInteraction}
          onPointerCancel={abortPointerInteraction}
          onLostPointerCapture={abortPointerInteraction}
        >
          {editable && traceUrl && traceVisible && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <img
                src={traceUrl}
                alt="Floorplan trace reference"
                onLoad={e => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    setTraceNaturalRatio(img.naturalWidth / img.naturalHeight);
                  }
                }}
                className="h-full w-full select-none object-contain transition-transform duration-75"
                style={{
                  opacity: traceOpacity,
                  transform: `translate(${traceOffsetX}%, ${traceOffsetY}%) scale(${traceScale})`,
                }}
              />
            </div>
          )}

          {!hasContent && (
            <p className="pointer-events-none absolute inset-8 flex items-center justify-center text-center text-sm text-muted-foreground">
              {floors.length > 1 ? 'This floor tab is empty.' : 'Empty floorplan.'}{' '}
              {canEdit ? 'Click Edit Layout to draw boxes, add lines, labels, or inventory zones.' : 'Zones and layout shapes will appear here when created.'}
            </p>
          )}

          {sortedRenderables.map(item => {
            const interactDisabled = editable && tool !== 'select';
            if (item.itemKind === 'shape') {
              const s = item.shape;
              if (s.kind === 'line') {
                const pts = getLineEndpoints(s);
                const lx1 = ((pts.x1 - s.x) / s.w) * 100;
                const ly1 = ((pts.y1 - s.y) / s.h) * 100;
                const lx2 = ((pts.x2 - s.x) / s.w) * 100;
                const ly2 = ((pts.y2 - s.y) / s.h) * 100;
                const strokePx = resolveLineWidth(s.lineWidth, compact);
                const dashProps = resolveLineDash(s.lineStyle, strokePx);
                const hitStrokePx = Math.max(14, strokePx + 12);
                return (
                  <div
                    key={s.id}
                    style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, height: `${s.h}%`, zIndex: item.zOrder }}
                    className="pointer-events-none absolute"
                  >
                    <svg className="pointer-events-none h-full w-full overflow-visible">
                      <line
                        x1={`${lx1}%`}
                        y1={`${ly1}%`}
                        x2={`${lx2}%`}
                        y2={`${ly2}%`}
                        strokeWidth={strokePx}
                        strokeDasharray={dashProps.strokeDasharray}
                        strokeLinecap={dashProps.strokeLinecap}
                        className={`pointer-events-none ${lineStrokeClass(s.lineColor)}`}
                      />
                      {editable && tool === 'select' && (
                        <line
                          x1={`${lx1}%`}
                          y1={`${ly1}%`}
                          x2={`${lx2}%`}
                          y2={`${ly2}%`}
                          stroke="transparent"
                          strokeWidth={hitStrokePx}
                          strokeLinecap="round"
                          pointerEvents="stroke"
                          aria-label="Floorplan divider line"
                          className="cursor-move touch-none"
                          onPointerDown={e =>
                            startElementDrag(e, 'shape', s.id, 'move', { x: s.x, y: s.y, w: s.w, h: s.h }, undefined, pts)
                          }
                          onClick={e => {
                            e.stopPropagation();
                            if (editable && e.detail === 0) selectSingleTarget({ kind: 'shape', id: s.id });
                          }}
                        />
                      )}
                    </svg>
                  </div>
                );
              }

              const isLabel = s.kind === 'label';
              const isInlineEditing = editable && editingInlineId === s.id;
              const appearance = resolveElementAppearance(s, isLabel, false, editable && onionView);
              const alignCls = (s.align ?? 'center') === 'left' ? 'items-start text-left' : 'items-center text-center';
              return (
                <div
                  key={s.id}
                  style={{
                    left: `${s.x}%`,
                    top: `${s.y}%`,
                    width: `${s.w}%`,
                    height: `${s.h}%`,
                    zIndex: isInlineEditing ? 900 : item.zOrder,
                    ...appearance.style,
                  }}
                  className={`absolute ${appearance.className} ${interactDisabled ? 'pointer-events-none' : ''}`}
                >
                  {isInlineEditing ? (
                    <textarea
                      autoFocus
                      aria-label="Edit label text"
                      value={inlineDraft}
                      onChange={e => setInlineDraft(e.target.value)}
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                      onBlur={() => commitInlineEdit(s.id)}
                      onKeyDown={e => {
                        if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
                          e.preventDefault();
                          e.stopPropagation();
                          commitInlineEdit(s.id);
                        }
                      }}
                      style={{ color: appearance.effectiveTextColor }}
                      className={`h-full w-full resize-none bg-background/95 p-1 text-foreground outline-none ${textFormatClasses(
                        s.bold,
                        s.italic,
                        s.underline,
                        'shape',
                      )} ${fontSizeClass(s.fontSize, compact)} ${(s.align ?? 'center') === 'left' ? 'text-left' : 'text-center'}`}
                    />
                  ) : (
                    <div
                      role={editable ? 'button' : undefined}
                      tabIndex={editable ? 0 : undefined}
                      aria-label={editable ? s.label || (isLabel ? 'Floorplan text label' : 'Floorplan box') : undefined}
                      className={`flex h-full w-full flex-col justify-center overflow-hidden ${
                        isLabel || compact ? 'p-0.5' : 'px-1.5 py-1'
                      } ${alignCls} ${editable ? 'cursor-move touch-none' : ''}`}
                      onPointerDown={e => startElementDrag(e, 'shape', s.id, 'move', { x: s.x, y: s.y, w: s.w, h: s.h })}
                      onDoubleClick={e => {
                        if (!editable || tool !== 'select') return;
                        e.stopPropagation();
                        setEditingInlineId(s.id);
                        setInlineDraft(s.label);
                      }}
                      onKeyDown={e => {
                        if (!editable || tool !== 'select') return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          selectSingleTarget({ kind: 'shape', id: s.id });
                        }
                      }}
                      onClick={e => {
                        e.stopPropagation();
                        if (editable && e.detail === 0) selectSingleTarget({ kind: 'shape', id: s.id });
                      }}
                    >
                      <span
                        style={rotatedTextStyle(s.rotate)}
                        className={`inline-block max-h-full max-w-full whitespace-pre-line ${textFormatClasses(
                          s.bold,
                          s.italic,
                          s.underline,
                          'shape',
                        )} ${fontSizeClass(s.fontSize, compact)}`}
                      >
                        {s.label}
                      </span>
                    </div>
                  )}
                </div>
              );
            }

            const z = item.zone;
            const b = item.box;
            const stats = summary(z.id);
            const highlight = highlightedZones?.[z.id];
            const isZoneMatched = hasHighlightSearch && Boolean(highlight && highlight.units > 0);
            const isZoneDimmed = hasHighlightSearch && !isZoneMatched;
            const isMultiZoneSelected = editing && multiSelected.some(m => m.kind === 'zone' && m.id === z.id);
            const isPrimaryZoneSelected = editing && chosen?.kind === 'zone' && chosen.id === z.id && multiSelected.length <= 1;
            const active = compact
              ? selected === z.id
              : editing
                ? isMultiZoneSelected || isPrimaryZoneSelected
                : focusedZoneId === z.id;
            const appearance = resolveElementAppearance(b, false, true, editable && onionView);
            const alignCls = (b.align ?? 'left') === 'center' ? 'items-center text-center' : 'items-start text-left';
            const verticalRotated = b.rotate === 90 || b.rotate === -90;
            return (
              <div
                key={z.id}
                style={{
                  left: `${b.x}%`,
                  top: `${b.y}%`,
                  width: `${b.w}%`,
                  height: `${b.h}%`,
                  zIndex: isZoneMatched && !editing ? Math.max(item.zOrder, 500) : item.zOrder,
                  ...appearance.style,
                }}
                className={`absolute transition-opacity ${appearance.className} ${interactDisabled ? 'pointer-events-none' : ''} ${
                  isZoneMatched
                    ? 'ring-2 ring-gold ring-offset-2 ring-offset-card shadow-md'
                    : !editing && active
                      ? 'ring-2 ring-gold ring-offset-2 ring-offset-card'
                      : ''
                } ${isZoneDimmed ? 'opacity-40' : ''}`}
              >
                {isZoneMatched && highlight && (
                  <span className="pointer-events-none absolute -top-2.5 right-1 z-30 rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-bold text-foreground shadow">
                    {highlight.units.toLocaleString()} matched
                  </span>
                )}
                <button
                  type="button"
                  aria-label={editing ? `Move ${z.name}` : compact ? `View ${z.name} inventory` : `Select ${z.name} zone`}
                  aria-pressed={active}
                  className={`flex h-full w-full flex-col justify-center overflow-hidden ${alignCls} ${
                    compact ? 'p-1 text-[10px]' : 'p-2.5 text-sm'
                  } ${editable ? 'cursor-move touch-none' : ''}`}
                  onPointerDown={e => startElementDrag(e, 'zone', z.id, 'move', { x: b.x, y: b.y, w: b.w, h: b.h })}
                  onDoubleClick={e => {
                    if (!editable || tool !== 'select') return;
                    e.stopPropagation();
                    onZoneAction('rename', z);
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    if (editing) {
                      if (e.detail === 0) selectSingleTarget({ kind: 'zone', id: z.id });
                    } else if (compact) onSelect(z.id);
                    else setFocusedZoneId(prev => (prev === z.id ? '' : z.id));
                  }}
                >
                  <div
                    style={rotatedTextStyle(b.rotate)}
                    className={`flex max-h-full max-w-full flex-col ${verticalRotated ? 'items-center' : ''}`}
                  >
                    <span
                      className={`max-w-full whitespace-pre-line ${textFormatClasses(
                        b.bold,
                        b.italic,
                        b.underline,
                        'zone-title',
                      )} ${fontSizeClass(b.fontSize, compact)}`}
                    >
                      {z.name}
                    </span>
                    {!compact && b.sublabel && (
                      <span
                        className={`mt-1 max-w-full whitespace-pre-line ${
                          appearance.effectiveTextColor ? 'opacity-85' : 'text-muted-foreground'
                        } ${textFormatClasses(b.bold, b.italic, b.underline, 'zone-sublabel')} ${fontSizeClass(
                          b.fontSize ?? 'xs',
                          false,
                        )}`}
                      >
                        {b.sublabel}
                      </span>
                    )}
                    {!compact && !verticalRotated && (
                      <span
                        className={`mt-1.5 text-[11px] ${
                          appearance.effectiveTextColor ? 'opacity-80' : 'text-muted-foreground'
                        }`}
                      >
                        {stats.units.toLocaleString()} units · {stats.products} products
                      </span>
                    )}
                  </div>
                </button>
              </div>
            );
          })}

          {editable &&
            sortedRenderables.map(item => {
              if (item.itemKind === 'shape') {
                const s = item.shape;
                const isMultiSelected = multiSelected.some(m => m.kind === 'shape' && m.id === s.id);
                const isPrimarySelected = chosen?.kind === 'shape' && chosen.id === s.id && multiSelected.length <= 1;
                if (!isMultiSelected && !isPrimarySelected) return null;
                if (editingInlineId === s.id) return null;

                if (s.kind === 'line') {
                  const pts = getLineEndpoints(s);
                  const lx1 = ((pts.x1 - s.x) / s.w) * 100;
                  const ly1 = ((pts.y1 - s.y) / s.h) * 100;
                  const lx2 = ((pts.x2 - s.x) / s.w) * 100;
                  const ly2 = ((pts.y2 - s.y) / s.h) * 100;
                  const strokePx = resolveLineWidth(s.lineWidth, compact);
                  const handleTitle = 'Drag endpoint to resize & aim freely (hold Shift for 45°/90°)';
                  return (
                    <div
                      key={`sel:${s.id}`}
                      style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, height: `${s.h}%`, zIndex: 800 }}
                      className="pointer-events-none absolute"
                    >
                      <svg aria-hidden="true" className="pointer-events-none h-full w-full overflow-visible">
                        <line
                          x1={`${lx1}%`}
                          y1={`${ly1}%`}
                          x2={`${lx2}%`}
                          y2={`${ly2}%`}
                          stroke="currentColor"
                          strokeWidth={strokePx + 6}
                          strokeLinecap="round"
                          className="pointer-events-none text-gold/45"
                        />
                      </svg>
                      {isPrimarySelected && tool === 'select' && (
                        <>
                          <span
                            aria-hidden="true"
                            title={`Start point (${pts.x1}%, ${pts.y1}%) — ${handleTitle}`}
                            onPointerDown={e =>
                              startElementDrag(e, 'shape', s.id, 'p1', { x: s.x, y: s.y, w: s.w, h: s.h }, undefined, pts)
                            }
                            className="pointer-events-auto absolute z-20 size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-gold bg-card shadow-sm transition-transform hover:scale-125 active:cursor-grabbing"
                            style={{ left: `${lx1}%`, top: `${ly1}%` }}
                          />
                          <span
                            aria-hidden="true"
                            title={`End point (${pts.x2}%, ${pts.y2}%) — ${handleTitle}`}
                            onPointerDown={e =>
                              startElementDrag(e, 'shape', s.id, 'p2', { x: s.x, y: s.y, w: s.w, h: s.h }, undefined, pts)
                            }
                            className="pointer-events-auto absolute z-20 flex size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full border-2 border-gold bg-card shadow-sm transition-transform hover:scale-125 active:cursor-grabbing"
                            style={{ left: `${lx2}%`, top: `${ly2}%` }}
                          >
                            <span className="size-1.5 rounded-full bg-gold" />
                          </span>
                        </>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={`sel:${s.id}`}
                    style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, height: `${s.h}%`, zIndex: 800 }}
                    className="pointer-events-none absolute border-2 border-dashed border-amber-500/90 ring-1 ring-gold/45"
                  >
                    {isPrimarySelected && tool === 'select' && (
                      <ResizeHandles
                        onHandlePointerDown={(e, h) => startElementDrag(e, 'shape', s.id, h, { x: s.x, y: s.y, w: s.w, h: s.h })}
                      />
                    )}
                  </div>
                );
              }

              const z = item.zone;
              const b = item.box;
              const isMultiZoneSelected = multiSelected.some(m => m.kind === 'zone' && m.id === z.id);
              const isPrimaryZoneSelected = chosen?.kind === 'zone' && chosen.id === z.id && multiSelected.length <= 1;
              if (!isMultiZoneSelected && !isPrimaryZoneSelected) return null;

              return (
                <div
                  key={`sel:zone:${z.id}`}
                  style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`, zIndex: 800 }}
                  className="pointer-events-none absolute border-2 border-dashed border-amber-500/90 ring-1 ring-gold/45"
                >
                  {isPrimaryZoneSelected && tool === 'select' && (
                    <ResizeHandles
                      onHandlePointerDown={(e, h) => startElementDrag(e, 'zone', z.id, h, { x: b.x, y: b.y, w: b.w, h: b.h })}
                    />
                  )}
                </div>
              );
            })}

          {marqueePreview && (() => {
            const x = Math.min(marqueePreview.x1, marqueePreview.x2);
            const y = Math.min(marqueePreview.y1, marqueePreview.y2);
            const w = Math.abs(marqueePreview.x2 - marqueePreview.x1);
            const h = Math.abs(marqueePreview.y2 - marqueePreview.y1);
            return (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-950 border border-dashed border-sky-500 bg-sky-500/10"
                style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
              />
            );
          })()}

          {drawPreview && drawPreview.kind === 'box' && (() => {
            const rect = normalizeRectFromPoints(drawPreview.x1, drawPreview.y1, drawPreview.x2, drawPreview.y2, snapStep, 2);
            return (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-950 border-2 border-dashed border-gold bg-gold/10"
                style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }}
              />
            );
          })()}

          {drawPreview && drawPreview.kind === 'line' && (() => {
            const lineGeom = createDrawnLineGeometry(
              drawPreview.x1,
              drawPreview.y1,
              drawPreview.x2,
              drawPreview.y2,
              snapStep,
              Boolean(drawPreview.shiftKey),
            );
            const seg = getLineEndpoints(lineGeom);
            return (
              <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-950 h-full w-full overflow-visible">
                <line
                  x1={`${seg.x1}%`}
                  y1={`${seg.y1}%`}
                  x2={`${seg.x2}%`}
                  y2={`${seg.y2}%`}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  className="stroke-sky-500"
                />
                <circle cx={`${seg.x1}%`} cy={`${seg.y1}%`} r={3.5} className="fill-card stroke-sky-500" strokeWidth={2} />
                <circle cx={`${seg.x2}%`} cy={`${seg.y2}%`} r={3.5} className="fill-sky-500" />
              </svg>
            );
          })()}

          {visibleDoors.map((d, i) => {
            const horizontal = d.edge === 'top' || d.edge === 'bottom';
            const interactDisabled = editable && tool !== 'select';
            return (
              <button
                key={d.id}
                type="button"
                aria-label={`Entrance ${i + 1}, ${d.edge} edge`}
                aria-pressed={editing && chosen?.kind === 'door' && chosen.id === d.id}
                onPointerDown={e => startElementDrag(e, 'door', d.id, 'door', undefined, d)}
                onClick={e => {
                  e.stopPropagation();
                  if (editable && tool === 'select' && e.detail === 0) selectSingleTarget({ kind: 'door', id: d.id });
                }}
                className={`absolute z-700 flex items-center justify-center border-2 border-foreground/50 bg-card text-foreground ${
                  compact ? 'h-5 w-7' : 'h-8 w-12'
                } ${editable && tool === 'select' ? 'cursor-move touch-none' : ''} ${
                  interactDisabled ? 'pointer-events-none' : ''
                } ${editing && chosen?.kind === 'door' && chosen.id === d.id ? 'ring-2 ring-gold ring-offset-2 ring-offset-card' : ''}`}
                style={{
                  left: horizontal ? `${d.offset}%` : d.edge === 'left' ? '0%' : '100%',
                  top: horizontal ? (d.edge === 'top' ? '0%' : '100%') : `${d.offset}%`,
                  transform: `translate(-50%, -50%) rotate(${d.edge === 'top' ? 180 : d.edge === 'left' ? 90 : d.edge === 'right' ? -90 : 0}deg)`,
                }}
              >
                <DoorOpen className={compact ? 'size-3' : 'size-5'} />
              </button>
            );
          })}
        </div>
      </div>

      {!compact && (
        <p className="text-xs text-muted-foreground">
          Not to Scale · Entrances show approximate access points.
          {canEdit && !editing && zones.length > 0 && ' Click Edit Layout to arrange zones, or click any zone to inspect it.'}
          {local && ' Visual arrangement saved in this browser only.'}
        </p>
      )}

      <Dialog open={cancelConfirmOpen} onOpenChange={open => { if (!open) setCancelConfirmOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Discard unsaved floorplan changes?</DialogTitle>
            <DialogDescription>
              You have edited the layout since your last save. Discarding will revert to the last saved floorplan and delete the temporary draft.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCancelConfirmOpen(false)}>Keep Editing</Button>
            <Button variant="destructive" onClick={discardEditsAndExit}>Discard Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!floorModal} onOpenChange={open => { if (!open) setFloorModal(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{floorModal?.mode === 'rename' ? 'Rename floor / map tab' : 'Add floor / building tab'}</DialogTitle>
            <DialogDescription>
              {floorModal?.mode === 'rename'
                ? 'Update the tab label shown above the warehouse map.'
                : 'Organize separate buildings or levels (for example, 6001-D and 6001-E) without crowding one canvas.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="floor-tab-name">Tab Name</Label>
            <Input
              id="floor-tab-name"
              autoFocus
              maxLength={60}
              value={floorNameInput}
              onChange={e => setFloorNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveFloorModal();
                }
              }}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setFloorModal(null)}>Cancel</Button>
            <Button disabled={!floorNameInput.trim()} onClick={saveFloorModal}>
              {floorModal?.mode === 'rename' ? 'Save Name' : 'Add Tab'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
