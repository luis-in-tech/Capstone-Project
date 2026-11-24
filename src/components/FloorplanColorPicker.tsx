import { useEffect, useRef, useState } from 'react';
import { CaretDownIcon as CaretDown } from '@phosphor-icons/react';
import {
  FLOORPLAN_COLORS,
  FLOORPLAN_FILL_PALETTE,
  FLOORPLAN_TEXT_PALETTE,
  hexToRgb,
  hexToRgba,
  normalizeHexColor,
  rgbToHex,
} from '../lib/warehouseFloorplan';

const PRESET_SWATCH_HEX: Record<number, string> = {
  0: '#F59E0B',
  1: '#10B981',
  2: '#8B5CF6',
  3: '#D97706',
  4: '#FFFFFF',
  5: '#94A3B8',
  6: '#0EA5E9',
};

interface FloorplanColorPickerProps {
  mode: 'fill' | 'text';
  presetIndex?: number;
  fillColor?: string;
  fillOpacity?: number;
  textColor?: string;
  ariaLabel: string;
  onSelectFillPreset?: (colorIdx: number) => void;
  onChangeCustomFill?: (fillColor: string | undefined, fillOpacity?: number) => void;
  onChangeTextColor?: (textColor: string | undefined) => void;
}

export function FloorplanColorPicker({
  mode,
  presetIndex = 4,
  fillColor,
  fillOpacity,
  textColor,
  ariaLabel,
  onSelectFillPreset,
  onChangeCustomFill,
  onChangeTextColor,
}: FloorplanColorPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeHex =
    mode === 'fill'
      ? fillColor ?? PRESET_SWATCH_HEX[presetIndex] ?? '#FFFFFF'
      : textColor ?? '#111827';

  const [hexDraft, setHexDraft] = useState(activeHex);

  useEffect(() => {
    setHexDraft(activeHex);
  }, [activeHex]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const rgb = hexToRgb(activeHex);
  const effectiveOpacity = fillOpacity ?? 1;
  const opacityPct = Math.round(effectiveOpacity * 100);

  function commitHex(nextHex: string, nextOpacity?: number) {
    const normalized = normalizeHexColor(nextHex);
    if (!normalized) return;
    setHexDraft(normalized);
    if (mode === 'fill') {
      onChangeCustomFill?.(normalized, nextOpacity ?? (fillColor ? fillOpacity ?? 1 : 1));
    } else {
      onChangeTextColor?.(normalized);
    }
  }

  function updateChannel(channel: 'r' | 'g' | 'b', raw: string) {
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    const nextRgb = { ...rgb, [channel]: Math.min(255, Math.max(0, Math.round(num))) };
    commitHex(rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b));
  }

  const presetMeta = FLOORPLAN_COLORS[presetIndex] ?? FLOORPLAN_COLORS[4];
  const triggerLabel =
    mode === 'fill'
      ? fillOpacity === 0
        ? 'Transparent'
        : fillColor
          ? `${fillColor}${fillOpacity !== undefined && fillOpacity < 1 ? ` · ${opacityPct}%` : ''}`
          : presetMeta.name
      : textColor ?? 'Default';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex h-7.5 items-center gap-1.5 rounded border bg-background px-2 text-xs text-foreground shadow-2xs transition-colors hover:bg-muted/60"
      >
        {mode === 'fill' ? (
          <span
            aria-hidden="true"
            className="size-3.5 shrink-0 rounded-xs border border-foreground/35"
            style={{
              backgroundColor:
                fillOpacity === 0
                  ? 'transparent'
                  : fillColor
                    ? hexToRgba(fillColor, effectiveOpacity)
                    : hexToRgba(PRESET_SWATCH_HEX[presetIndex] ?? '#FFFFFF', presetIndex === 4 ? 1 : 0.3),
              backgroundImage:
                fillOpacity === 0
                  ? 'linear-gradient(45deg, #cbd5e1 25%, transparent 25%, transparent 75%, #cbd5e1 75%), linear-gradient(45deg, #cbd5e1 25%, transparent 25%, transparent 75%, #cbd5e1 75%)'
                  : undefined,
              backgroundSize: fillOpacity === 0 ? '6px 6px' : undefined,
              backgroundPosition: fillOpacity === 0 ? '0 0, 3px 3px' : undefined,
            }}
          />
        ) : (
          <span aria-hidden="true" className="flex flex-col items-center leading-none">
            <span className="text-[11px] font-bold">A</span>
            <span
              className="mt-0.5 h-1 w-3.5 rounded-full border border-foreground/25"
              style={{ backgroundColor: textColor ?? 'currentColor' }}
            />
          </span>
        )}
        <span className="max-w-22 truncate">{triggerLabel}</span>
        <CaretDown className="size-3 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-50 mt-1.5 w-68 max-w-[calc(100vw-2rem)] space-y-2.5 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-xl"
        >
          {mode === 'fill' ? (
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Theme Tints</div>
              <div className="flex flex-wrap gap-1.5">
                {FLOORPLAN_COLORS.map(c => {
                  const active = !fillColor && fillOpacity !== 0 && presetIndex === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      title={c.name}
                      onClick={() => {
                        onSelectFillPreset?.(c.id);
                        setOpen(false);
                      }}
                      className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition ${
                        active ? 'border-gold bg-gold/15 font-semibold' : 'border-border hover:bg-muted/70'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="size-2.5 rounded-full border border-foreground/30"
                        style={{
                          backgroundColor: hexToRgba(PRESET_SWATCH_HEX[c.id] ?? '#FFFFFF', c.id === 4 ? 1 : 0.35),
                        }}
                      />
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">Text Palette</span>
              <button
                type="button"
                onClick={() => {
                  onChangeTextColor?.(undefined);
                  setOpen(false);
                }}
                className={`rounded border px-2 py-0.5 text-[11px] transition ${
                  !textColor ? 'border-gold bg-gold/15 font-semibold' : 'border-border hover:bg-muted/70'
                }`}
              >
                Reset Default
              </button>
            </div>
          )}

          <div>
            {mode === 'fill' && (
              <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Color Palette</div>
            )}
            <div className="grid grid-cols-8 gap-1.5">
              {(mode === 'fill' ? FLOORPLAN_FILL_PALETTE : FLOORPLAN_TEXT_PALETTE).map(swatch => {
                const selected =
                  mode === 'fill'
                    ? fillColor?.toUpperCase() === swatch.hex
                    : textColor?.toUpperCase() === swatch.hex;
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    title={`${swatch.name} (${swatch.hex})`}
                    aria-label={`${swatch.name} ${swatch.hex}`}
                    onClick={() => commitHex(swatch.hex)}
                    className={`size-6 rounded border transition-transform hover:scale-110 ${
                      selected ? 'ring-2 ring-gold ring-offset-1 ring-offset-popover' : 'border-foreground/25'
                    }`}
                    style={{ backgroundColor: swatch.hex }}
                  />
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5 border-t border-border/60 pt-2">
            <div className="text-[11px] font-medium text-muted-foreground">Custom RGB / Hex</div>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                aria-label={`${ariaLabel} picker`}
                value={activeHex}
                onChange={e => commitHex(e.target.value)}
                className="h-7.5 w-9 shrink-0 cursor-pointer rounded border bg-background p-0.5"
              />
              <input
                type="text"
                aria-label={`${ariaLabel} hex`}
                maxLength={7}
                value={hexDraft}
                onChange={e => {
                  const val = e.target.value;
                  setHexDraft(val);
                  const normalized = normalizeHexColor(val);
                  if (normalized) commitHex(normalized);
                }}
                onBlur={() => setHexDraft(activeHex)}
                className="w-20 rounded border bg-background px-1.5 py-1 font-mono text-[11px] uppercase text-foreground"
              />
              {(['r', 'g', 'b'] as const).map(ch => (
                <label key={ch} className="flex flex-1 flex-col items-center gap-0.5">
                  <input
                    type="number"
                    min={0}
                    max={255}
                    aria-label={`${ariaLabel} ${ch.toUpperCase()}`}
                    value={rgb[ch]}
                    onChange={e => updateChannel(ch, e.target.value)}
                    className="w-full rounded border bg-background px-1 py-0.5 text-center text-[11px] tabular-nums text-foreground"
                  />
                  <span className="text-[9px] font-semibold uppercase text-muted-foreground">{ch}</span>
                </label>
              ))}
            </div>
          </div>

          {mode === 'fill' && (
            <div className="space-y-1.5 border-t border-border/60 pt-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-muted-foreground">Fill Opacity</span>
                <span className="font-mono text-foreground">{opacityPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                aria-label="Fill opacity percentage"
                value={opacityPct}
                onChange={e => {
                  const nextAlpha = Math.round(Number(e.target.value)) / 100;
                  onChangeCustomFill?.(fillColor ?? PRESET_SWATCH_HEX[presetIndex] ?? '#FFFFFF', nextAlpha);
                }}
                className="h-1.5 w-full cursor-pointer accent-gold"
              />
              <div className="flex flex-wrap gap-1">
                {[
                  { label: 'Clear', val: 0 },
                  { label: '25%', val: 0.25 },
                  { label: '55%', val: 0.55 },
                  { label: '100%', val: 1 },
                ].map(opt => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() =>
                      onChangeCustomFill?.(fillColor ?? PRESET_SWATCH_HEX[presetIndex] ?? '#FFFFFF', opt.val)
                    }
                    className={`rounded border px-1.5 py-0.5 text-[10px] transition ${
                      Math.abs(effectiveOpacity - opt.val) < 0.03
                        ? 'border-gold bg-gold/15 font-semibold'
                        : 'border-border hover:bg-muted/70'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

