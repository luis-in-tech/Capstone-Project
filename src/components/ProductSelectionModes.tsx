import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Camera, ClipboardList, ScanBarcode, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createProductSelection, type BatchResolver, type SelectionOutcome } from '../lib/productSelection';

// All modes resolve against the caller's eligible records, including original return lines.
export function ProductSelectionModes<T extends { sku: string }>({ products, onAdd, children, active = true, hint, resolveBatch, getProductId }: {
  products: T[]; onAdd: (product: T) => string | void; children: ReactNode; active?: boolean; hint: string;
  resolveBatch?: BatchResolver; getProductId?: (product: T) => string;
}) {
  const [mode, setMode] = useState<'select' | 'sku' | 'scan'>('select');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const [pending, setPending] = useState(false);
  const id = useId();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef<number | null>(null);
  const session = useRef(0);
  const latest = useRef({ products, onAdd, active, resolveBatch, getProductId });
  latest.current = { products, onAdd, active, resolveBatch, getProductId };
  const selection = useRef<ReturnType<typeof createProductSelection<T>> | null>(null);
  if (!selection.current) selection.current = createProductSelection(() => latest.current, setMessage, setPending);

  function stopCamera() {
    selection.current!.cancel();
    session.current++;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    setScanning(false);
  }
  useEffect(() => {
    stopCamera();
    setMessage('');
    if (!active) { setMode('select'); setCode(''); }
    return stopCamera;
  }, [mode, active]);

  function addCode(value: string): SelectionOutcome | Promise<SelectionOutcome> {
    const finish = (outcome: SelectionOutcome) => {
      if (outcome === 'selected') { stopCamera(); setCode(''); }
      return outcome;
    };
    const result = selection.current!.submit(value, mode === 'scan', window.location.origin);
    return result instanceof Promise ? result.then(finish) : finish(result);
  }

  async function startCamera() {
    const Detector = (window as any).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setMessage('Camera scanning is unavailable in this browser. Use a scanner or enter a SKU below.');
      return;
    }
    stopCamera();
    setMessage('');
    const current = session.current;
    setScanning(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (current !== session.current || !video.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      video.current.srcObject = media;
      await video.current.play();
      if (current !== session.current) return;
      const detector = new Detector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      let lastUnknown = '';
      let retryAfter = 0;
      const scan = async () => {
        if (current !== session.current || !video.current) return;
        try {
          const codes = await detector.detect(video.current);
          if (current !== session.current) return;
          const value = codes[0]?.rawValue?.trim();
          if (value && value !== lastUnknown && Date.now() >= retryAfter) {
            const outcome = await addCode(value);
            if (outcome === 'selected') return;
            if (outcome === 'rejected') lastUnknown = value;
            if (outcome === 'retryable') retryAfter = Date.now() + 2000;
          }
        } catch { /* Retry unreadable frames. */ }
        if (current === session.current) frame.current = requestAnimationFrame(scan);
      };
      frame.current = requestAnimationFrame(scan);
    } catch {
      if (current !== session.current) return;
      stopCamera();
      setMessage('Unable to access the camera. Check permission or enter the SKU.');
    }
  }

  return <div className="space-y-3">
    <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Product selection method">
      {([{ id: 'select', label: 'Select products', icon: Search }, { id: 'sku', label: 'Enter SKU', icon: ClipboardList }, { id: 'scan', label: 'Scan code', icon: ScanBarcode }] as const).map(tab => <Button key={tab.id} type="button" size="sm" className="flex-1 min-w-0 px-1 text-xs sm:px-2.5 [&_svg]:hidden sm:[&_svg]:block" variant={mode === tab.id ? 'default' : 'ghost'} aria-pressed={mode === tab.id} onClick={() => setMode(tab.id)}><tab.icon className="size-4" />{tab.label}</Button>)}
    </div>
    {mode === 'select' ? children : <div className="space-y-4 rounded-xl border p-4">
      {mode === 'scan' && <><div className="relative flex aspect-video max-h-56 items-center justify-center overflow-hidden rounded-lg bg-zinc-950"><video ref={video} muted playsInline className="h-full w-full object-cover" />{!scanning && <ScanBarcode className="absolute size-10 text-zinc-500" />}</div><Button type="button" variant="outline" disabled={!active} onClick={scanning ? stopCamera : startCamera}><Camera className="size-4" />{scanning ? 'Stop camera' : 'Start camera'}</Button></>}
      <Label htmlFor={id}>{mode === 'scan' ? 'Scanner input / SKU' : 'Product SKU'}</Label>
      <div className="flex gap-2"><Input id={id} value={code} onChange={event => setCode(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (active && !pending && code.trim()) void addCode(code); } }} placeholder="Enter an exact SKU" /><Button type="button" disabled={!active || pending || !code.trim()} onClick={() => { void addCode(code); }}>Add</Button></div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {mode === 'scan' && <p className="text-xs text-muted-foreground">Scan a code containing the product SKU.</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </div>}
  </div>;
}
