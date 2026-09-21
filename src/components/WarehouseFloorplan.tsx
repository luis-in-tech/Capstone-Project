import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { DoorOpen, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import type { WarehouseZone } from '../lib/warehouseLayout';

type Box = { x: number; y: number; w: number; h: number; color: number };
type Door = { id: string; edge: 'top' | 'bottom' | 'left' | 'right'; offset: number };
type Plan = { boxes: Record<string, Box>; doors: Door[] };
const colors = ['bg-gold/15 border-gold/50', 'bg-emerald-500/15 border-emerald-500/40', 'bg-violet-500/15 border-violet-500/40', 'bg-amber-500/15 border-amber-500/40'];
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const initial: Plan = { boxes: {}, doors: [{ id: 'entrance', edge: 'bottom', offset: 50 }] };
function boxFor(plan: Plan, zone: WarehouseZone, index: number): Box {
  return plan.boxes[zone.id] || { x: 8 + index % 2 * 44, y: 8 + Math.floor(index / 2) % 3 * 27, w: 40, h: 24, color: index % colors.length };
}
function validPlan(value: unknown): value is Plan {
  if (!value || typeof value !== 'object') return false;
  const p = value as Plan;
  return !!p.boxes && typeof p.boxes === 'object' && !Array.isArray(p.boxes) && Array.isArray(p.doors)
    && Object.values(p.boxes).every(b => b && [b.x, b.y, b.w, b.h, b.color].every(Number.isFinite) && b.x >= 0 && b.y >= 0 && b.w >= 12 && b.h >= 12 && b.x + b.w <= 100 && b.y + b.h <= 100 && Number.isInteger(b.color) && b.color >= 0 && b.color < colors.length)
    && p.doors.every(d => d && typeof d.id === 'string' && ['top', 'bottom', 'left', 'right'].includes(d.edge) && Number.isFinite(d.offset) && d.offset >= 6 && d.offset <= 94);
}

export function WarehouseFloorplan({ warehouseId, storageKey, zones, canEdit, compact = false, selected, onSelect, onZoneAction, summary }: {
  warehouseId: string; storageKey: string; zones: WarehouseZone[]; canEdit: boolean; compact?: boolean; selected: string;
  onSelect: (id: string) => void; onZoneAction: (mode: 'add' | 'rename' | 'delete', zone?: WarehouseZone) => void;
  summary: (id: string) => { units: number; products: number };
}) {
  const [plan, setPlan] = useState<Plan>(initial);
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState('');
  const [local, setLocal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const saved = useRef(plan);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; id: string; kind: string; x: number; y: number; box?: Box; door?: Door } | null>(null);
  const editable = editing && canEdit && !saving;
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await supabase.from('warehouse_floorplans').select('layout').eq('warehouseId', warehouseId).maybeSingle();
        if (!active) return;
        let value: unknown = result.data?.layout || initial;
        const fallback = !!result.error && ['PGRST205', '42P01'].includes(result.error.code);
        if (result.error && !fallback) throw result.error;
        if (fallback) value = JSON.parse(localStorage.getItem(`${storageKey}:floorplan`) || 'null') || initial;
        if (!validPlan(value)) throw new Error('The saved floorplan is unreadable. It has not been overwritten.');
        setPlan(value); saved.current = value; setLocal(fallback);
      } catch (e) { if (active) setError((e as Error).message); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [warehouseId, storageKey]);
  useEffect(() => { if (!canEdit) { setEditing(false); setPlan(saved.current); drag.current = null; } }, [canEdit]);

  async function save() {
    if (!editable) return;
    setSaving(true);
    const next = { ...plan, boxes: Object.fromEntries(zones.map((z, i) => [z.id, boxFor(plan, z, i)])) };
    try {
      if (local) localStorage.setItem(`${storageKey}:floorplan`, JSON.stringify(next));
      else {
        const result = await supabase.from('warehouse_floorplans').upsert({ warehouseId, layout: next }, { onConflict: 'warehouseId' });
        if (result.error) throw result.error;
      }
      saved.current = next; setPlan(next); setEditing(false); setChosen(''); toast.success('Layout saved');
    } catch (e) { toast.error((e as Error).message || 'Unable to save layout'); }
    finally { setSaving(false); }
  }
  function start(e: PointerEvent, id: string, kind: string, box?: Box, door?: Door) {
    if (!editable || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); setChosen(id);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointer: e.pointerId, id, kind, x: e.clientX, y: e.clientY, box, door };
  }
  function move(e: PointerEvent) {
    const d = drag.current; const bounds = canvas.current?.getBoundingClientRect();
    if (!editable || !d || !bounds || d.pointer !== e.pointerId) return;
    const dx = (e.clientX - d.x) / bounds.width * 100; const dy = (e.clientY - d.y) / bounds.height * 100;
    if (d.door) {
      const offset = clamp(d.door.offset + (['top', 'bottom'].includes(d.door.edge) ? dx : dy), 6, 94);
      setPlan(p => ({ ...p, doors: p.doors.map(door => door.id === d.id ? { ...door, offset } : door) }));
    } else if (d.box) {
      const b = d.box; let next = { ...b };
      if (d.kind === 'move') next = { ...b, x: clamp(b.x + dx, 0, 100 - b.w), y: clamp(b.y + dy, 0, 100 - b.h) };
      else {
        if (d.kind.includes('e')) next.w = clamp(b.w + dx, 12, 100 - b.x);
        if (d.kind.includes('s')) next.h = clamp(b.h + dy, 12, 100 - b.y);
        if (d.kind.includes('w')) { next.x = clamp(b.x + dx, 0, b.x + b.w - 12); next.w = b.x + b.w - next.x; }
        if (d.kind.includes('n')) { next.y = clamp(b.y + dy, 0, b.y + b.h - 12); next.h = b.y + b.h - next.y; }
      }
      setPlan(p => ({ ...p, boxes: { ...p.boxes, [d.id]: next } }));
    }
  }
  const zone = zones.find(z => z.id === chosen);
  const door = plan.doors.find(d => d.id === chosen);
  if (loading) return <p className="p-6 text-sm text-muted-foreground">Loading floorplan...</p>;
  if (error) return <p role="alert" className="p-6 text-sm text-destructive">Unable to load floorplan: {error}</p>;
  return <div className="space-y-4">
    {!compact && canEdit && <div className="flex flex-wrap gap-2">
      {!editing ? <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" />Edit Layout</Button> : <>
        <Button disabled={saving} onClick={save}><Save className="size-4" />{saving ? 'Saving...' : 'Save Layout'}</Button>
        <Button variant="outline" disabled={saving} onClick={() => { setPlan(saved.current); setEditing(false); setChosen(''); }}>Cancel</Button>
        <Button variant="outline" disabled={saving} onClick={() => onZoneAction('add')}><Plus className="size-4" />Add Zone</Button>
        <Button variant="outline" disabled={saving} onClick={() => { const d: Door = { id: crypto.randomUUID(), edge: 'bottom', offset: 25 }; setPlan(p => ({ ...p, doors: [...p.doors, d] })); setChosen(d.id); }}><DoorOpen className="size-4" />Add Entrance/Door</Button>
      </>}
    </div>}
    {editable && <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <p className="text-muted-foreground">Select and drag zones to move them; use their handles to resize. Drag entrances along their edge. Save Layout saves positions, colors and entrances. Zone name and deletion changes save immediately.</p>
      {zone && <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{zone.name}</span><Button size="sm" variant="outline" onClick={() => onZoneAction('rename', zone)}>Rename Zone</Button><Button size="sm" variant="outline" onClick={() => onZoneAction('delete', zone)}><Trash2 className="size-3" />Delete Zone</Button><label className="flex items-center gap-2">Color<select className="rounded border bg-background p-1" value={boxFor(plan, zone, zones.indexOf(zone)).color} onChange={e => { const b = boxFor(plan, zone, zones.indexOf(zone)); setPlan(p => ({ ...p, boxes: { ...p.boxes, [zone.id]: { ...b, color: Number(e.target.value) } } })); }}>{['Gold', 'Green', 'Violet', 'Amber'].map((c, i) => <option key={c} value={i}>{c}</option>)}</select></label></div>}
      {door && <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2">Entrance edge<select className="rounded border bg-background p-1" value={door.edge} onChange={e => setPlan(p => ({ ...p, doors: p.doors.map(d => d.id === door.id ? { ...d, edge: e.target.value as Door['edge'] } : d) }))}>{['top', 'bottom', 'left', 'right'].map(edge => <option key={edge} value={edge}>{edge[0].toUpperCase() + edge.slice(1)}</option>)}</select></label><Button size="sm" variant="outline" onClick={() => { setPlan(p => ({ ...p, doors: p.doors.filter(d => d.id !== door.id) })); setChosen(''); }}><Trash2 className="size-3" />Delete Entrance</Button></div>}
    </div>}
    <div className={compact ? 'p-2' : 'overflow-x-auto p-4'}>
      <div ref={canvas} aria-label="Warehouse floorplan, not to scale" className={`relative border-[3px] border-foreground/45 bg-muted/15 ${compact ? 'h-44' : 'h-[460px] min-w-[520px]'}`}
        onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        {!zones.length && <p className="absolute inset-8 flex items-center justify-center text-center text-sm text-muted-foreground">No zones yet. {canEdit ? 'Use Edit Layout to add a zone.' : 'Zones will appear here when created.'}</p>}
        {zones.map((z, i) => { const b = boxFor(plan, z, i); const stats = summary(z.id); const active = editing ? chosen === z.id : selected === z.id;
          return <div key={z.id} className={`absolute border-2 ${colors[b.color]} ${active ? 'z-10 ring-2 ring-gold ring-offset-2 ring-offset-card' : ''}`} style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}>
            <button type="button" aria-label={editing ? `Move ${z.name}` : `View ${z.name} inventory`} aria-pressed={active} className={`flex h-full w-full flex-col justify-center overflow-hidden text-left ${compact ? 'p-1 text-[10px]' : 'p-3 text-sm'} ${editable ? 'touch-none cursor-move' : ''}`} onPointerDown={e => start(e, z.id, 'move', b)} onClick={() => editing ? setChosen(z.id) : onSelect(z.id)} onKeyDown={e => {
              if (!editable || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
              e.preventDefault(); setPlan(p => ({ ...p, boxes: { ...p.boxes, [z.id]: { ...b, x: clamp(b.x + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0), 0, 100 - b.w), y: clamp(b.y + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0), 0, 100 - b.h) } } }));
            }}><span className="max-w-full truncate font-semibold">{z.name}</span>{!compact && <span className="mt-2 text-xs text-muted-foreground">{stats.units.toLocaleString()} units · {stats.products} products</span>}</button>
            {editable && active && ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(handle => <span key={handle} aria-hidden="true" onPointerDown={e => start(e, z.id, handle, b)} className="absolute size-3 touch-none border-2 border-gold bg-card" style={{ left: handle.includes('w') ? '0%' : handle.includes('e') ? '100%' : '50%', top: handle.includes('n') ? '0%' : handle.includes('s') ? '100%' : '50%', transform: 'translate(-50%, -50%)', cursor: `${handle}-resize` }} />)}
          </div>;
        })}
        {plan.doors.map((d, i) => { const horizontal = d.edge === 'top' || d.edge === 'bottom'; return <button key={d.id} type="button" aria-label={`Entrance ${i + 1}, ${d.edge} edge`} aria-pressed={chosen === d.id} onPointerDown={e => start(e, d.id, 'door', undefined, d)} onClick={() => editable && setChosen(d.id)} onKeyDown={e => {
          if (!editable || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault(); setChosen(d.id);
          const delta = horizontal ? (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0) : (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0);
          setPlan(p => ({ ...p, doors: p.doors.map(item => item.id === d.id ? { ...item, offset: clamp(item.offset + delta, 6, 94) } : item) }));
        }} className={`absolute z-20 flex items-center justify-center border-2 border-foreground/50 bg-card text-foreground ${compact ? 'h-5 w-7' : 'h-8 w-12'} ${editable ? 'touch-none cursor-move' : ''} ${editing && chosen === d.id ? 'ring-2 ring-gold ring-offset-2 ring-offset-card' : ''}`} style={{ left: horizontal ? `${d.offset}%` : d.edge === 'left' ? '0%' : '100%', top: horizontal ? d.edge === 'top' ? '0%' : '100%' : `${d.offset}%`, transform: `translate(-50%, -50%) rotate(${d.edge === 'top' ? 180 : d.edge === 'left' ? 90 : d.edge === 'right' ? -90 : 0}deg)` }}><DoorOpen className={compact ? 'size-3' : 'size-5'} /></button>; })}
      </div>
    </div>
    {!compact && <p className="text-xs text-muted-foreground">Not to Scale · Entrances show approximate access points.{local && ' Visual arrangement saved in this browser only.'}</p>}
  </div>;
}
