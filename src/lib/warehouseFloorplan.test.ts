import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FLOORPLAN_HEIGHT_PRESETS,
  INITIAL_FLOORPLAN,
  belongsToFloor,
  boxPropsFromShape,
  clampGroupDelta,
  computeAlignDeltas,
  computeDistributeDeltas,
  computeMatchSizes,
  createDrawnLineGeometry,
  duplicateShape,
  extractBoxStyle,
  getLineEndpoints,
  getLineMetrics,
  moveLinePoints,
  normalizeRectFromPoints,
  parseFloorplanImport,
  rectIntersects,
  resizeLineLength,
  resolveEffectiveFloorId,
  resolveLineDash,
  resolveLineWidth,
  rotateLineAngle,
  shapeGeometryFromLinePoints,
  snapPct,
  straightenLine,
  suggestZoneNameFromShape,
  updateLineEndpoint,
  validFloorplan,
  type FloorplanData,
} from './warehouseFloorplan';

test('validFloorplan accepts legacy layouts, rich zones, shapes, lines, and custom heights', () => {
  assert.equal(validFloorplan(INITIAL_FLOORPLAN), true);
  assert.ok(FLOORPLAN_HEIGHT_PRESETS.some(p => p.value === 520 && p.label === 'Default (520px)'));

  const legacyPlan = {
    boxes: { z1: { x: 8, y: 8, w: 40, h: 24, color: 0 } },
    doors: [{ id: 'entrance', edge: 'bottom', offset: 50 }],
  };
  assert.equal(validFloorplan(legacyPlan), true);

  const richPlan: FloorplanData = {
    height: 840,
    boxes: {
      z1: {
        x: 6,
        y: 10,
        w: 4,
        h: 22,
        color: 4,
        sublabel: 'Tires\nTubes\nBikes',
        fontSize: 'xs',
        rotate: -90,
        align: 'center',
        border: 'solid',
        z: 12,
      },
    },
    doors: [{ id: 'd1', edge: 'top', offset: 48 }],
    shapes: [
      { id: 's-park', kind: 'label', label: '6001 E PARKING', x: 10, y: 2, w: 80, h: 5, color: 4, border: 'solid', align: 'center', z: 5 },
      { id: 's-line', kind: 'line', label: '', x: 42, y: 45, w: 12, h: 1, color: 4, lineColor: 'blue', lineAxis: 'h', border: 'solid', z: 8 },
      { id: 's-container', kind: 'box', label: 'Frame & Wheelset', x: 40, y: 55, w: 45, h: 35, color: 4, border: 'solid', z: 1 },
    ],
  };
  assert.equal(validFloorplan(richPlan), true);
});

test('validFloorplan rejects out-of-bounds shapes or invalid colors', () => {
  assert.equal(validFloorplan(null), false);
  assert.equal(
    validFloorplan({
      boxes: { z1: { x: 90, y: 10, w: 15, h: 10, color: 0 } },
      doors: [],
    }),
    false,
  );
  assert.equal(
    validFloorplan({
      boxes: {},
      doors: [],
      shapes: [{ id: 'bad', kind: 'box', label: 'X', x: 5, y: 5, w: 1, h: 10, color: 4 }],
    }),
    false,
  );
});

test('snapPct, normalizeRectFromPoints, and duplicateShape stay accurate within [0, 100]', () => {
  assert.equal(snapPct(13.4, 2), 14);
  assert.equal(snapPct(13.4, 5), 15);
  assert.equal(snapPct(13.47, 0), 13.5);

  const rect = normalizeRectFromPoints(52, 61, 30, 15, 5, 2);
  assert.deepEqual(rect, { x: 30, y: 15, w: 20, h: 45 });

  const dup = duplicateShape(
    { id: 'a', kind: 'box', label: 'Rack 1', x: 92, y: 90, w: 6, h: 8, color: 4 },
    'b',
  );
  assert.equal(dup.id, 'b');
  assert.ok(dup.x + dup.w <= 100);
  assert.ok(dup.y + dup.h <= 100);

  const lineGeom = shapeGeometryFromLinePoints({ x1: 10, y1: 20, x2: 30, y2: 40 });
  const dupLine = duplicateShape(
    { id: 'l1', kind: 'line', label: '', color: 4, lineColor: 'blue', lineWidth: 4, lineStyle: 'dotted', ...lineGeom },
    'l2',
  );
  assert.deepEqual(dupLine.linePoints, { x1: 13, y1: 23, x2: 33, y2: 43 });
  assert.equal(dupLine.lineWidth, 4);
  assert.equal(dupLine.lineStyle, 'dotted');
});

test('validFloorplan accepts and validates 2-point lines, thickness, and solid/dashed/dotted styles', () => {
  const customLinePlan: FloorplanData = {
    boxes: {},
    doors: [],
    shapes: [
      {
        id: 'l-diag',
        kind: 'line',
        label: '',
        ...shapeGeometryFromLinePoints({ x1: 31.8, y1: 65.6, x2: 40.8, y2: 69.6 }),
        color: 4,
        lineColor: 'gold',
        lineWidth: 6,
        lineStyle: 'dotted',
      },
      {
        id: 'l-broken',
        kind: 'line',
        label: '',
        ...shapeGeometryFromLinePoints({ x1: 50, y1: 10, x2: 50, y2: 45 }),
        color: 4,
        lineColor: 'red',
        lineWidth: 1,
        lineStyle: 'dashed',
      },
    ],
  };
  assert.equal(validFloorplan(customLinePlan), true);

  assert.equal(
    validFloorplan({
      boxes: {},
      doors: [],
      shapes: [
        {
          id: 'bad-width',
          kind: 'line',
          label: '',
          x: 10,
          y: 10,
          w: 10,
          h: 1,
          color: 4,
          lineWidth: 20,
        },
      ],
    }),
    false,
  );

  assert.equal(
    validFloorplan({
      boxes: {},
      doors: [],
      shapes: [
        {
          id: 'bad-style',
          kind: 'line',
          label: '',
          x: 10,
          y: 10,
          w: 10,
          h: 1,
          color: 4,
          lineStyle: 'wavy' as never,
        },
      ],
    }),
    false,
  );

  assert.equal(
    validFloorplan({
      boxes: {},
      doors: [],
      shapes: [
        {
          id: 'zero-pts',
          kind: 'line',
          label: '',
          x: 10,
          y: 10,
          w: 1,
          h: 1,
          color: 4,
          linePoints: { x1: 10, y1: 10, x2: 10, y2: 10 },
        },
      ],
    }),
    false,
  );
});

test('free 2-point line editing supports 360deg aiming, length/angle adjustment, Shift snap, and dashes', () => {
  const legacyDiag = getLineEndpoints({ x: 10, y: 20, w: 20, h: 10, lineAxis: 'diag-up' });
  assert.deepEqual(legacyDiag, { x1: 10, y1: 30, x2: 30, y2: 20 });

  const pts = { x1: 20, y1: 50, x2: 40, y2: 50 };
  const shortened = resizeLineLength(pts, 8);
  assert.deepEqual(shortened, { x1: 20, y1: 50, x2: 28, y2: 50 });

  const lengthened = resizeLineLength(pts, 45);
  assert.deepEqual(lengthened, { x1: 20, y1: 50, x2: 65, y2: 50 });

  const rotatedDown = rotateLineAngle(pts, 90);
  assert.deepEqual(rotatedDown, { x1: 20, y1: 50, x2: 20, y2: 70 });
  assert.deepEqual(getLineMetrics(rotatedDown), { length: 20, angleDeg: 90 });

  // Pivoting a vertical line to horizontal preserves non-zero length
  const pivotedH = straightenLine(rotatedDown, 'h');
  assert.equal(pivotedH.y1, pivotedH.y2);
  assert.equal(getLineMetrics(pivotedH).length, 20);

  // Moving both endpoints preserves length and snaps cleanly within [0, 100]
  const moved = moveLinePoints({ x1: 20, y1: 30, x2: 50, y2: 40 }, 10, -5, 1, true);
  assert.deepEqual(moved, { x1: 30, y1: 25, x2: 60, y2: 35 });

  // Free endpoint drag can reverse direction across the other endpoint & locks 45/90 with Shift
  const flipped = updateLineEndpoint(pts, 'p2', 5, 35, 0, true);
  assert.deepEqual(flipped, { x1: 20, y1: 50, x2: 5, y2: 35 });

  // Collapsing endpoints keeps minimum 0.5% span so line stays selectable
  const nonZero = updateLineEndpoint(pts, 'p2', 20, 50, 0, false);
  assert.ok(Math.hypot(nonZero.x2 - nonZero.x1, nonZero.y2 - nonZero.y1) >= 0.5);

  // Free draw preserves arbitrary angle instead of forcing H/V axis snap
  const freeDrawn = createDrawnLineGeometry(10, 20, 42, 27, 0, false);
  assert.deepEqual(freeDrawn.linePoints, { x1: 10, y1: 20, x2: 42, y2: 27 });

  // Dash and thickness resolution for solid / dashed / dotted
  assert.equal(resolveLineWidth(undefined), 2);
  assert.equal(resolveLineWidth(6), 6);
  assert.equal(resolveLineWidth(6, true), 3.9);
  assert.equal(resolveLineDash('solid', 4).strokeDasharray, undefined);
  assert.equal(resolveLineDash('dashed', 4).strokeLinecap, 'butt');
  assert.ok(resolveLineDash('dashed', 4).strokeDasharray?.includes(' '));
  assert.equal(resolveLineDash('dotted', 4).strokeLinecap, 'round');
  assert.ok(resolveLineDash('dotted', 4).strokeDasharray?.startsWith('0.1 '));
});

test('box-to-zone conversion, alignment, distribution, size match, and group clamping', () => {
  const shape = {
    id: 'b1',
    kind: 'box' as const,
    label: 'Show room\nGround floor',
    x: 20,
    y: 12,
    w: 18,
    h: 40,
    color: 4,
    rotate: -90 as const,
    fontSize: 'xs' as const,
    align: 'center' as const,
    border: 'solid' as const,
    floor: 'floor-1',
    z: 10,
  };
  const converted = boxPropsFromShape(shape);
  assert.deepEqual(converted, {
    x: 20,
    y: 12,
    w: 18,
    h: 40,
    color: 4,
    fontSize: 'xs',
    rotate: -90,
    align: 'center',
    border: 'solid',
    z: 10,
    floor: 'floor-1',
  });
  assert.equal(suggestZoneNameFromShape('Tires\nTubes', []), 'Tires / Tubes');
  assert.equal(suggestZoneNameFromShape('Helmet', ['helmet', 'Helmet 2']), 'Helmet 3');

  const items = [
    { kind: 'shape' as const, id: 's1', x: 10, y: 20, w: 8, h: 25 },
    { kind: 'shape' as const, id: 's2', x: 35, y: 30, w: 12, h: 15 },
    { kind: 'zone' as const, id: 'z1', x: 70, y: 15, w: 10, h: 30 },
  ];

  const alignTop = computeAlignDeltas(items, 'top');
  assert.deepEqual(alignTop['shape:s1'], { dx: 0, dy: -5 });
  assert.deepEqual(alignTop['shape:s2'], { dx: 0, dy: -15 });
  assert.deepEqual(alignTop['zone:z1'], { dx: 0, dy: 0 });

  const alignRight = computeAlignDeltas(items, 'right');
  assert.deepEqual(alignRight['shape:s1'], { dx: 62, dy: 0 });
  assert.deepEqual(alignRight['zone:z1'], { dx: 0, dy: 0 });

  const distH = computeDistributeDeltas(items, 'h');
  // span [10..80] = 70, widths = 8+12+10 = 30, equal gap = 20 -> s2 lands at x = 10 + 8 + 20 = 38 (dx = +3)
  assert.deepEqual(distH['shape:s1'], { dx: 0, dy: 0 });
  assert.deepEqual(distH['shape:s2'], { dx: 3, dy: 0 });
  assert.deepEqual(distH['zone:z1'], { dx: 0, dy: 0 });

  const matchH = computeMatchSizes(items, items[0], 'h');
  assert.equal(matchH['shape:s2'].h, 25);
  assert.equal(matchH['zone:z1'].h, 25);

  // Group move stops rigidly at wall boundaries
  const grp = clampGroupDelta(items, 40, -30, 0, false);
  assert.deepEqual(grp, { dx: 20, dy: -15 });

  assert.equal(rectIntersects({ x: 10, y: 10, w: 20, h: 20 }, { x: 25, y: 25, w: 10, h: 10 }), true);
  assert.equal(rectIntersects({ x: 10, y: 10, w: 10, h: 10 }, { x: 25, y: 25, w: 10, h: 10 }), false);

  const boxStyle = extractBoxStyle(shape);
  assert.equal(boxStyle.styleKind, 'rect');
  if (boxStyle.styleKind === 'rect') {
    assert.equal(boxStyle.rotate, -90);
    assert.equal(boxStyle.border, 'solid');
  }
});

test('multi-floor filtering, validation, and JSON floorplan import handle legacy and multi-floor data safely', () => {
  const floors = [
    { id: 'f-6001d', name: '6001-D' },
    { id: 'f-6001e', name: '6001-E' },
  ];
  assert.equal(resolveEffectiveFloorId(undefined, floors), 'f-6001d');
  assert.equal(resolveEffectiveFloorId('missing', floors), 'f-6001d');
  assert.equal(resolveEffectiveFloorId('f-6001e', floors), 'f-6001e');
  assert.equal(belongsToFloor(undefined, 'f-6001d', floors), true);
  assert.equal(belongsToFloor(undefined, 'f-6001e', floors), false);
  assert.equal(belongsToFloor('f-6001e', 'f-6001e', floors), true);

  const exported = JSON.stringify({
    floors,
    height: 840,
    boxes: { z1: { x: 10, y: 10, w: 20, h: 20, color: 4, floor: 'f-6001e' } },
    doors: [{ id: 'd1', edge: 'top', offset: 50, floor: 'f-6001d' }],
    shapes: [],
  });
  const imported = parseFloorplanImport(exported);
  assert.equal(imported.floors?.length, 2);
  assert.equal(imported.boxes.z1.floor, 'f-6001e');

  assert.throws(() => parseFloorplanImport('{not json'), /not valid JSON/i);
  assert.throws(() => parseFloorplanImport(JSON.stringify({ floors: [{ id: '', name: 'Bad' }], boxes: {}, doors: [] })), /floorplan format/i);
});


