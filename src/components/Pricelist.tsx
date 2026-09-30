import { SearchBar } from '@/components/ui/search-bar';
import { PricelistBuilder } from './PricelistBuilder';
import { PriceType, PricelistItem, SavedPricelist, sectionsFor } from '../lib/pricelistSections';
import { useStaffAccess } from '../hooks/useStaffAccess';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, db, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc } from '../lib/supabaseAdapter';
import { Product, Warehouse } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Check, Download, Eye, FileText, Loader2, Pencil, Plus, ScanLine, Trash2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Gemini Vision – Pricelist Image Scanner
// ---------------------------------------------------------------------------
const GEMINI_API_KEY = (import.meta.env.VITE_GEMINI_API_KEY as string) || '';

// Pre-optimized candidate vision models in priority order of stability & quota availability
const CANDIDATE_VISION_MODELS = [
  { ver: 'v1', model: 'gemini-3.5-flash' },
  { ver: 'v1beta', model: 'gemini-3.5-flash' },
  { ver: 'v1', model: 'gemini-3.6-flash' },
  { ver: 'v1beta', model: 'gemini-3.6-flash' },
  { ver: 'v1', model: 'gemini-3.8-flash' },
  { ver: 'v1beta', model: 'gemini-3.8-flash' },
  { ver: 'v1', model: 'gemini-3.7-flash' },
];

/**
 * Compresses and scales down user-uploaded images in the browser
 * to prevent multi-megabyte payloads from causing timeouts or quota spikes.
 * Fills solid white background so transparent PNG screenshots do not render black text on black.
 */
async function compressImageForOcr(file: File, maxDimension = 2400, quality = 0.90): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image data.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          const rawBase64 = (reader.result as string).split(',')[1];
          return resolve({ base64: rawBase64, mimeType: file.type || 'image/jpeg' });
        }

        // Fill solid white background so transparent PNGs do not become black in JPEG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.split(',')[1];
        resolve({ base64, mimeType: 'image/jpeg' });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

async function scanPricelistImage(file: File, startingSkuNumber = 1, existingProducts: Product[] = []): Promise<PricelistItem[]> {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('MY_')) {
    throw new Error('Missing Gemini API Key in .env. Please update VITE_GEMINI_API_KEY in your .env file.');
  }

  const { base64, mimeType } = await compressImageForOcr(file);

  const startSkuStr = `SKU-${String(startingSkuNumber).padStart(3, '0')}`;
  const nextSkuStr = `SKU-${String(startingSkuNumber + 1).padStart(3, '0')}`;

  const prompt = `You are an expert OCR and bike shop pricelist extractor.
Carefully examine the entire pricelist image, including all tables, rows, columns, and text.
Extract EVERY single product item row and its corresponding price.

Rules:
- "sku": product SKU or code if clearly printed in the table row. If no SKU is visible, generate sequential SKUs starting from ${startSkuStr} ("${startSkuStr}", "${nextSkuStr}", etc.).
- "name": full item name and description exactly as written in the row (e.g. include brand, model, size, speed, specs). Strip leading numbering like "#29 " if desired, but keep the full descriptive model name.
- "category": product group or category (e.g. "Bikes", "Mountain Bikes", "Components", or "General").
- "price": NUMERIC price of the product (strip currency symbols like ₱, $, PHP, and remove commas e.g. "34,000.00" becomes 34000). DO NOT return 0 if a price is printed in the table row.

Ignore store address, phone numbers, and notices like "PRICES SUBJECT TO CHANGE".
Extract ALL rows from top to bottom.
Return ONLY a valid JSON array matching this schema:
[{ "sku": "${startSkuStr}", "name": "GIANT TALON 1 ( BLACK - SMALL)", "category": "Bikes", "price": 34000 }]`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inlineData: { mimeType, data: base64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      maxOutputTokens: 8192
    },
  };

  let rawJsonText = '';
  let lastError = '';

  for (const { ver, model } of CANDIDATE_VISION_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (rawJsonText) break;
      }

      const errBody = await res.clone().json().catch(() => ({})) as { error?: { message?: string } };
      lastError = errBody?.error?.message || `HTTP ${res.status}`;
      continue;
    } catch (fetchErr: any) {
      lastError = fetchErr.message || 'Network error';
      continue;
    }
  }

  if (!rawJsonText) {
    if (lastError.toLowerCase().includes('quota') || lastError.includes('429')) {
      throw new Error('Google AI Studio Free Tier rate limit reached. Please wait ~30 seconds before scanning again.');
    }
    throw new Error(lastError || 'Gemini Vision scan failed. Please verify image clarity and try again.');
  }

  // Robustly extract the first JSON array or object from the response
  const extractJson = (text: string): string => {
    let s = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const arrayMatch = s.match(/(\[[\s\S]*\])/);
    if (arrayMatch) {
      s = arrayMatch[1];
    } else {
      const objMatch = s.match(/(\{[\s\S]*\})/);
      if (objMatch) s = objMatch[1];
    }
    s = s.replace(/,\s*([}\]])/g, '$1');
    return s;
  };

  let parsed: any;
  try {
    parsed = JSON.parse(extractJson(rawJsonText));
  } catch {
    throw new Error('Could not parse the product list from the image. Try taking a closer or clearer photo.');
  }

  // Handle both direct arrays [...] and wrapped objects { products: [...] }, { items: [...] }
  let itemsArray: Array<Record<string, unknown>> = [];
  if (Array.isArray(parsed)) {
    itemsArray = parsed;
  } else if (parsed && typeof parsed === 'object') {
    for (const key of ['products', 'items', 'pricelists', 'data', 'entries', 'rows']) {
      if (Array.isArray(parsed[key])) {
        itemsArray = parsed[key];
        break;
      }
    }
    if (!itemsArray.length) {
      const anyArr = Object.values(parsed).find(v => Array.isArray(v));
      if (anyArr) itemsArray = anyArr as Array<Record<string, unknown>>;
    }
  }

  if (!itemsArray.length) {
    throw new Error('No product items were detected in the image. Please ensure the pricelist table is clearly visible.');
  }

  const parsePriceNum = (v: unknown): number => {
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    if (v === null || v === undefined) return 0;
    const str = String(v).replace(/[^0-9.]/g, '');
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  };

  return itemsArray.map((item, i) => {
    const rawPrice = item.price ?? item.unitPrice ?? item.unit_price ?? item.cost ?? item.amount ?? item.rate ?? item.price_php ?? item.item_price ?? 0;
    const itemName = String(item.name || item.product_name || item.item_name || item.description || 'Unknown Product').trim();

    // Check if product already exists in inventory by matching name
    const matchedProduct = existingProducts.find(p => p.name.trim().toLowerCase() === itemName.toLowerCase());
    const fallbackSeqSku = `SKU-${String(startingSkuNumber + i).padStart(3, '0')}`;
    let finalSku = matchedProduct?.sku || String(item.sku || item.code || item.item_code || fallbackSeqSku).trim();

    // If Gemini returned a 1-based generic SKU like SKU-001 or SKU-1, but our starting sequence is higher (e.g. SKU-026), remap to the continuous sequence
    const genericMatch = finalSku.match(/^SKU-0*([0-9]+)$/i);
    if (genericMatch && startingSkuNumber > 1 && !matchedProduct) {
      const parsedNum = parseInt(genericMatch[1], 10);
      if (parsedNum <= itemsArray.length) {
        finalSku = fallbackSeqSku;
      }
    }

    return {
      productId: `scan-${Date.now()}-${i}`,
      sku: finalSku || fallbackSeqSku,
      name: itemName,
      category: String(item.category || item.product_category || item.group || 'Bikes'),
      priceType: 'base' as PriceType,
      price: parsePriceNum(rawPrice),
    };
  });
}

function getNextSkuSequence(products: Product[], saved: SavedPricelist[], pendingItems?: PricelistItem[] | null): number {
  let maxNum = 0;
  const allSkus = [
    ...products.map(p => p.sku),
    ...saved.flatMap(s => (s.items || []).map(i => i.sku)),
    ...(pendingItems ? pendingItems.map(i => i.sku) : [])
  ];
  for (const s of allSkus) {
    const match = String(s || '').match(/^SKU-0*([0-9]+)$/i);
    if (match) {
      const val = parseInt(match[1], 10);
      if (!isNaN(val) && val > maxNum) {
        maxNum = val;
      }
    }
  }
  return maxNum + 1;
}

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------
const KEY = 'activepro.savedPricelists';
const typeLabel = (type: PriceType) => type === 'metroManila' ? 'Metro Manila' : type === 'provincial' ? 'Provincial' : type === 'promo' ? 'Promo' : 'Regular';
const schemeLabel = (type: PriceType) => `${typeLabel(type)} Price`;
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'emdash';
const listType = (p: SavedPricelist) => { const types = [...new Set(p.items.map(i => i.priceType))]; return types.length === 1 ? typeLabel(types[0]) : 'Mixed'; };
const escapeHtml = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function readSaved(): SavedPricelist[] { try { const data = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(data) ? data.map((p: SavedPricelist & { exportedAt?: string; products?: Product[] }) => ({ ...p, createdAt: p.createdAt || p.exportedAt || new Date().toISOString(), items: p.items || (p.products || []).map(x => ({ productId: x.id, sku: x.sku, name: x.name, category: x.category, priceType: 'base', price: Number(x.basePrice || 0) })) })) : []; } catch { return []; } }

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function Pricelist() {
  const { profile } = useAuth();
  const { permissions } = useStaffAccess();
  const [products, setProducts] = useState<Product[]>([]), [warehouses, setWarehouses] = useState<Warehouse[]>([]), [inventory, setInventory] = useState<Array<{ productId: string; quantity: number }>>([]), [saved, setSaved] = useState<SavedPricelist[]>(readSaved), [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(''), [dateFilter, setDateFilter] = useState('all'), [typeFilter, setTypeFilter] = useState('all'), [pdfFilter, setPdfFilter] = useState('all');
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [viewId, setViewId] = useState(''), [renameId, setRenameId] = useState(''), [rename, setRename] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SavedPricelist | undefined>();
  const [selectedPdfId, setSelectedPdfId] = useState('');

  // Image scan state
  const scanInputRef = useRef<HTMLInputElement>(null);
  const appendScanInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanItems, setScanItems] = useState<PricelistItem[] | null>(null);
  const [scanName, setScanName] = useState('');
  const [scanPreviewUrl, setScanPreviewUrl] = useState('');

  const canEdit = permissions.pricelist === 'edit';

  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const unsubProducts = onSnapshot(collection(db, 'products'), s => {
      setProducts(s.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as Product)));
      setLoading(false);
    }, e => {
      handleSupabaseError(e, OperationType.GET, 'products');
      setLoading(false);
    });

    const unsubWarehouses = onSnapshot(collection(db, 'warehouses'), s => {
      setWarehouses(s.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as Warehouse)));
    }, () => {});

    const unsubInventory = onSnapshot(collection(db, 'inventory'), s => {
      setInventory(s.docs.map((d: { data: () => Record<string, unknown> }) => ({ productId: String(d.data().productId || ''), quantity: Number(d.data().quantity || 0) })));
    }, () => {});

    const unsubPricelists = onSnapshot(collection(db, 'pricelists'), s => {
      const dbLists = s.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as SavedPricelist));
      if (dbLists.length > 0) {
        setSaved(prev => {
          const map = new Map<string, SavedPricelist>();
          prev.forEach(item => map.set(item.id, item));
          dbLists.forEach(item => map.set(item.id, item));
          const merged = Array.from(map.values()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          localStorage.setItem(KEY, JSON.stringify(merged));
          return merged;
        });
      }
    }, () => {});

    return () => {
      unsubProducts();
      unsubWarehouses();
      unsubInventory();
      unsubPricelists();
    };
  }, []);

  const stockMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of inventory) {
      if (item.productId) {
        map[item.productId] = (map[item.productId] || 0) + (item.quantity || 0);
      }
    }
    return map;
  }, [inventory]);

  const save = (next: SavedPricelist[]) => {
    setSaved(next);
    localStorage.setItem(KEY, JSON.stringify(next));
    try {
      for (const item of next) {
        setDoc(doc(db, 'pricelists', item.id), item).catch(() => {});
      }
    } catch {}
  };
  const filtered = useMemo(() => { const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), week = new Date(today), month = new Date(now.getFullYear(), now.getMonth(), 1); week.setDate(today.getDate() - today.getDay()); return saved.filter(p => { const d = new Date(p.createdAt); const dateOk = dateFilter === 'all' || (dateFilter === 'today' && d >= today) || (dateFilter === 'week' && d >= week) || (dateFilter === 'month' && d >= month) || (dateFilter === 'custom' && (!from || d >= new Date(from + 'T00:00:00')) && (!to || d <= new Date(to + 'T23:59:59'))); return p.name.toLowerCase().includes(search.toLowerCase()) && dateOk && (typeFilter === 'all' || listType(p) === typeFilter) && (pdfFilter === 'all' || (pdfFilter === 'exported' && !!p.lastPdfGeneratedAt) || (pdfFilter === 'never' && !p.lastPdfGeneratedAt)); }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }, [saved, search, dateFilter, typeFilter, pdfFilter, from, to]);
  const view = saved.find(p => p.id === viewId);
  const closeCreate = () => { setCreateOpen(false); setEditing(undefined); };
  const saveBuilder = async (list: SavedPricelist, draft: boolean) => {
    await setDoc(doc(db, 'pricelists', list.id), JSON.parse(JSON.stringify(list)));
    setSaved(previous => {
      const next = [list, ...previous.filter(p => p.id !== list.id)];
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
    closeCreate();
    toast.success(draft ? 'Pricelist saved as draft' : 'Pricelist saved');
  };
  const generatePdf = (target = view, recordExport = true) => {
    if (!target) return;
    let tableRows = '';
    for (const { name: cat, items } of sectionsFor(target)) {
      tableRows += `<tr style="background-color: #f1f5f9; font-weight: bold;"><td colspan="4" style="padding: 10px 12px; font-size: 14px; border: 1px solid #cbd5e1; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(cat)}</td></tr>`;
      for (const i of items) {
        tableRows += `<tr>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-family: monospace; font-size: 12px;">${escapeHtml(i.sku)}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;">${escapeHtml(i.name)}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-size: 12px; color: #475569;">${schemeLabel(i.priceType)}</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: right; font-weight: bold; color: #0f172a;">₱${i.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>`;
      }
    }

    const w = window.open('', '_blank');
    if (!w) return toast.error('Allow pop-ups to preview this pricelist PDF');
    w.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(target.name)}</title><style>body{font-family:'Segoe UI',Roboto,sans-serif;padding:32px;color:#1e293b;max-width:900px;margin:0 auto}h1{margin-bottom:4px;font-size:24px;color:#0f172a}p{color:#64748b;font-size:13px;margin-top:0;margin-bottom:24px}table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#0f172a;color:white;padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.5px}td{font-size:13px}</style></head><body><h1>${escapeHtml(target.name)}</h1><p>Date Created: ${dateLabel(target.createdAt)}</p><table><thead><tr><th>SKU</th><th>Item Name</th><th>Price Scheme</th><th style="text-align:right;">Price</th></tr></thead><tbody>${tableRows}</tbody></table></body></html>`);
    w.document.close();
    if (recordExport) save(saved.map(p => p.id === target.id ? { ...p, lastPdfGeneratedAt: new Date().toISOString() } : p));
  };
  const doRename = () => { if (!rename.trim()) return; save(saved.map(p => p.id === renameId ? { ...p, name: rename.trim(), updatedAt: new Date().toISOString() } : p)); setRenameId(''); toast.success('Pricelist renamed'); };
  const remove = (p: SavedPricelist) => { if (window.confirm(`Delete "${p.name}"? This action cannot be undone.`)) { save(saved.filter(x => x.id !== p.id)); deleteDoc(doc(db, 'pricelists', p.id)).catch(() => {}); toast.success('Pricelist deleted'); } };

  // Image scan handlers
  const handleScanClick = () => scanInputRef.current?.click();
  const handleScanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file.'); return; }
    setScanPreviewUrl(URL.createObjectURL(file));
    setScanName(`Scanned Pricelist - ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
    setScanning(true);
    try {
      const startNum = getNextSkuSequence(products, saved);
      const items = await scanPricelistImage(file, startNum, products);
      if (!items.length) { toast.error('No products found in the image. Try a clearer photo.'); setScanning(false); return; }
      setScanItems(items);
      toast.success(`${items.length} products extracted starting from SKU-${String(startNum).padStart(3, '0')}.`);
    } catch (err) {
      toast.error(`Scan failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setScanning(false);
      if (scanInputRef.current) scanInputRef.current.value = '';
    }
  };

  const handleAppendScanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file.'); return; }
    setScanning(true);
    try {
      const startNum = getNextSkuSequence(products, saved, scanItems);
      const newItems = await scanPricelistImage(file, startNum, products);
      if (!newItems.length) { toast.error('No products found in the image.'); setScanning(false); return; }
      setScanItems(prev => [...(prev || []), ...newItems]);
      toast.success(`Added ${newItems.length} products (SKU-${String(startNum).padStart(3, '0')} to SKU-${String(startNum + newItems.length - 1).padStart(3, '0')}).`);
    } catch (err) {
      toast.error(`Scan failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setScanning(false);
      if (appendScanInputRef.current) appendScanInputRef.current.value = '';
    }
  };
  const confirmScan = async () => {
    if (!scanItems?.length || !scanName.trim() || syncing) return;
    setSyncing(true);

    const p: SavedPricelist = { id: crypto.randomUUID(), name: scanName.trim(), createdAt: new Date().toISOString(), items: scanItems };
    save([p, ...saved]);

    let newCount = 0;
    let updateCount = 0;

    try {
      let activeWarehouses = warehouses.filter(w => w.active !== false);
      if (!activeWarehouses.length) {
        try {
          const whSnap = await getDocs(collection(db, 'warehouses'));
          activeWarehouses = whSnap.docs
            .map((d: any) => ({ id: d.id, ...d.data() } as Warehouse))
            .filter(w => w.active !== false);
        } catch {
          // ignore warehouse lookup error
        }
      }

      const syncedProducts = [...products];

      for (const item of scanItems) {
        const itemSku = (item.sku || '').trim();
        const itemName = (item.name || '').trim();

        const existing = syncedProducts.find(
          x => (itemSku && x.sku.trim().toLowerCase() === itemSku.toLowerCase()) ||
               (itemName && x.name.trim().toLowerCase() === itemName.toLowerCase())
        );

        if (existing) {
          const updates: Record<string, unknown> = {
            updatedAt: new Date().toISOString(),
          };

          if (item.priceType === 'metroManila') {
            updates.mmPrice = item.price;
            updates.wholesalePrice = item.price;
          } else if (item.priceType === 'provincial') {
            updates.provincialPrice = item.price;
            updates.dealerPrice = item.price;
          } else if (item.priceType === 'promo') {
            updates.promoPrice = item.price;
          } else {
            updates.basePrice = item.price;
            if (!existing.mmPrice) updates.mmPrice = item.price;
            if (!existing.provincialPrice) updates.provincialPrice = item.price;
          }

          await updateDoc(doc(db, 'products', existing.id), updates);
          updateCount++;
        } else {
          const newId = crypto.randomUUID();
          const newProduct = {
            id: newId,
            sku: itemSku,
            name: itemName,
            category: (item.category || 'General').trim(),
            basePrice: item.price,
            mmPrice: item.priceType === 'metroManila' ? item.price : item.price,
            wholesalePrice: item.priceType === 'metroManila' ? item.price : item.price,
            provincialPrice: item.priceType === 'provincial' ? item.price : item.price,
            dealerPrice: item.priceType === 'provincial' ? item.price : item.price,
            promoPrice: item.priceType === 'promo' ? item.price : null,
            costPrice: 0,
            minStockLevel: 5,
            reorderPoint: 10,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await addDoc(collection(db, 'products'), newProduct);
          syncedProducts.push(newProduct as Product);
          newCount++;

          for (const wh of activeWarehouses) {
            try {
              await addDoc(collection(db, 'inventory'), {
                productId: newId,
                warehouseId: wh.id,
                quantity: 0,
                lastUpdated: serverTimestamp(),
              });
            } catch {
              // ignore inventory initialisation error
            }
          }
        }
      }

      const details = [];
      if (newCount > 0) details.push(`${newCount} new products added`);
      if (updateCount > 0) details.push(`${updateCount} existing prices updated`);

      toast.success(
        `"${p.name}" saved! ${details.join(', ') || 'Synced to catalog'}.`,
        { description: 'All products are now available in Inventory and Order Entry.' }
      );
    } catch (err: any) {
      console.error('Pricelist catalog sync error:', err);
      toast.warning(
        `"${p.name}" saved locally, but database sync had an issue: ${err.message || 'Check database permissions.'}`
      );
    } finally {
      setSyncing(false);
      setScanItems(null);
      setScanPreviewUrl('');
      setScanName('');
    }
  };
  const cancelScan = () => { if (syncing) return; setScanItems(null); setScanPreviewUrl(''); setScanName(''); };

  if (loading) return <div className="flex min-h-[400px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin"/></div>;
  return (
    <div className="space-y-5 pb-20">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="mt-1 text-sm text-muted-foreground">Create and manage saved pricelists using products from Inventory.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!selectedPdfId} onClick={() => generatePdf(saved.find(p => p.id === selectedPdfId))}><Download className="mr-2 h-4 w-4"/>Generate PDF</Button>
          {canEdit && (
            <>
              <Button variant="outline" onClick={handleScanClick} disabled={scanning}>
                {scanning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Scanning...</> : <><ScanLine className="mr-2 h-4 w-4"/>Scan Image</>}
              </Button>
              <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4"/>Create Pricelist</Button>
            </>
          )}
        </div>
      </div>

      <input ref={scanInputRef} type="file" accept="image/*" className="hidden" onChange={handleScanFile}/>
      <input ref={appendScanInputRef} type="file" accept="image/*" className="hidden" onChange={handleAppendScanFile}/>

      <div className="rounded-2xl border bg-card p-4"><div className="grid gap-3 md:grid-cols-4"><div><label className="text-xs invisible select-none block">Search</label><div className="relative mt-1"><SearchBar className="pl-9" placeholder="Search by pricelist name..." value={search} onValueChange={setSearch}/></div></div><Filter label="Date Created" value={dateFilter} set={setDateFilter} options={[["all","All Dates"],["today","Today"],["week","This Week"],["month","This Month"],["custom","Custom Date Range"]]}/><Filter label="Pricelist Type" value={typeFilter} set={setTypeFilter} options={[["all","All Types"],["Regular","Regular"],["Metro Manila","Metro Manila"],["Provincial","Provincial"],["Promo","Promo"],["Mixed","Mixed"]]}/><Filter label="PDF Status" value={pdfFilter} set={setPdfFilter} options={[["all","All Statuses"],["never","Never Exported"],["exported","Exported"]]}/></div>{dateFilter === 'custom' && <div className="mt-3 grid grid-cols-2 gap-3"><Field label="From" value={from} set={setFrom}/><Field label="To" value={to} set={setTo}/></div>}</div>

      <div className="overflow-x-auto rounded-2xl border"><Table><TableHeader><TableRow><TableHead className="w-12"/><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Items</TableHead><TableHead>Date Created</TableHead><TableHead>Last PDF Generated</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filtered.map(p => <TableRow key={p.id}><TableCell><input type="checkbox" checked={selectedPdfId === p.id} onChange={e => setSelectedPdfId(e.target.checked ? p.id : '')}/></TableCell><TableCell><span className="flex items-center gap-2 font-bold"><FileText className="h-5 w-5"/>{p.name}</span></TableCell><TableCell>{listType(p)}</TableCell><TableCell>{p.items.length}</TableCell><TableCell>{dateLabel(p.createdAt)}</TableCell><TableCell>{dateLabel(p.lastPdfGeneratedAt)}</TableCell><TableCell><div className="flex justify-end gap-2"><Icon title="View" onClick={() => setViewId(p.id)}><Eye/></Icon>{canEdit && <><Icon title="Edit pricelist" onClick={() => { setEditing(p); setCreateOpen(true); }}><Pencil/></Icon><Icon title="Rename" onClick={() => { setRenameId(p.id); setRename(p.name); }}><Pencil/></Icon><Icon title="Delete" danger onClick={() => remove(p)}><Trash2/></Icon></>}</div></TableCell></TableRow>)}{!filtered.length && <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted-foreground">No saved pricelists match the selected filters.</TableCell></TableRow>}</TableBody></Table></div>

      <Dialog open={!!view} onOpenChange={o => !o && setViewId('')}><DialogContent className="max-h-[94vh] w-[96vw] max-w-[96vw] overflow-y-auto sm:!max-w-[96vw] lg:!max-w-[96vw]"><DialogHeader><DialogTitle>{view?.name}</DialogTitle><DialogDescription>{view && `${view.items.length} items - Created ${dateLabel(view.createdAt)}`}</DialogDescription></DialogHeader><Items items={view?.items || []} sections={view?.sections} stockMap={stockMap}/><DialogFooter><Button variant="outline" onClick={() => setViewId('')}>Close</Button><Button onClick={() => generatePdf()}><Download className="mr-2 h-4 w-4"/>Generate PDF</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!renameId && canEdit} onOpenChange={o => !o && setRenameId('')}><DialogContent><DialogHeader><DialogTitle>Rename Pricelist</DialogTitle></DialogHeader><Label>Pricelist Name</Label><Input value={rename} onChange={e => setRename(e.target.value)}/><DialogFooter><Button variant="outline" onClick={() => setRenameId('')}>Cancel</Button><Button onClick={doRename}>Rename</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!scanItems} onOpenChange={o => !o && !syncing && cancelScan()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <DialogTitle className="flex items-center gap-2">
                <ScanLine className="h-5 w-5"/>Review Scanned Pricelist
              </DialogTitle>
              <Badge variant="outline" className="w-fit text-xs font-normal border-emerald-500/40 text-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/40">
                Auto-syncs to Inventory &amp; Order Entry
              </Badge>
            </div>
            <DialogDescription>
              {scanItems?.length ?? 0} products extracted. Review, edit prices if needed, and save to update the Inventory catalog and Order Entry in real-time.
            </DialogDescription>
          </DialogHeader>
          {scanPreviewUrl && (
            <div className="overflow-hidden rounded-xl border">
              <img src={scanPreviewUrl} alt="Scanned pricelist" className="max-h-52 w-full object-contain bg-muted"/>
            </div>
          )}
          <div className="space-y-2">
            <Label>Pricelist Name</Label>
            <Input value={scanName} onChange={e => setScanName(e.target.value)} placeholder="Enter a name for this pricelist"/>
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">SKU</TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead className="w-36">Category</TableHead>
                  <TableHead className="w-40">Price Scheme</TableHead>
                  <TableHead className="w-36 text-right">Price (₱)</TableHead>
                  <TableHead className="w-12 text-center" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(scanItems || []).map((item, idx) => (
                  <TableRow key={item.productId || idx}>
                    <TableCell>
                      <Input
                        className="h-8 font-mono text-xs"
                        value={item.sku}
                        onChange={e => {
                          const val = e.target.value;
                          setScanItems(prev => prev ? prev.map((x, i) => i === idx ? { ...x, sku: val } : x) : null);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-sm font-medium"
                        value={item.name}
                        onChange={e => {
                          const val = e.target.value;
                          setScanItems(prev => prev ? prev.map((x, i) => i === idx ? { ...x, name: val } : x) : null);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-xs"
                        value={item.category}
                        onChange={e => {
                          const val = e.target.value;
                          setScanItems(prev => prev ? prev.map((x, i) => i === idx ? { ...x, category: val } : x) : null);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={item.priceType}
                        onValueChange={val => {
                          setScanItems(prev => prev ? prev.map((x, i) => i === idx ? { ...x, priceType: val as PriceType } : x) : null);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue>{schemeLabel(item.priceType)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="base">Regular Price</SelectItem>
                          <SelectItem value="metroManila">Metro Manila Price</SelectItem>
                          <SelectItem value="provincial">Provincial Price</SelectItem>
                          <SelectItem value="promo">Promo Price</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        className="h-8 text-right font-bold text-sm"
                        value={item.price}
                        onChange={e => {
                          const val = parseFloat(e.target.value) || 0;
                          setScanItems(prev => prev ? prev.map((x, i) => i === idx ? { ...x, price: val } : x) : null);
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => {
                          setScanItems(prev => prev ? prev.filter((_, i) => i !== idx) : null);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="flex-col sm:flex-row sm:justify-between items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => appendScanInputRef.current?.click()}
              disabled={scanning || syncing}
            >
              {scanning ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Scanning next page...</>
              ) : (
                <><Plus className="mr-2 h-4 w-4"/>Add Another Page / Image</>
              )}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={cancelScan} disabled={syncing}>Cancel</Button>
              <Button onClick={confirmScan} disabled={!scanName.trim() || !scanItems?.length || syncing}>
                {syncing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Syncing Catalog...</>
                ) : (
                  <><Check className="mr-2 h-4 w-4"/>Save &amp; Sync to Catalog</>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {createOpen && canEdit && <PricelistBuilder initial={editing} products={products} stockMap={stockMap} close={closeCreate} save={saveBuilder} preview={list => generatePdf(list, false)} />}
    </div>
  );
}

function Filter({label,value,set,options}:{label:string;value:string;set:(v:string)=>void;options:string[][]}){return <div><Label className="text-xs">{label}</Label><Select value={value} onValueChange={v=>v&&set(v)}><SelectTrigger className="mt-1"><SelectValue>{options.find(x=>x[0]===value)?.[1]}</SelectValue></SelectTrigger><SelectContent>{options.map(([v,l])=><SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>}
function Field({label,value,set}:{label:string;value:string;set:(v:string)=>void}){return <div><Label>{label}</Label><Input type="date" value={value} onChange={e=>set(e.target.value)}/></div>}
function Icon({title,onClick,danger,children}:{title:string;onClick:()=>void;danger?:boolean;children:React.ReactElement}){return <Button variant="outline" size="icon" title={title} onClick={onClick} className={danger?'text-destructive':''}>{React.cloneElement(children,{className:'h-4 w-4'} as React.HTMLAttributes<HTMLElement>)}</Button>}

function Items({ items, sections, stockMap = {} }: { items: PricelistItem[]; sections?: SavedPricelist['sections']; stockMap?: Record<string, number> }) {
  const grouped = sectionsFor({ items, sections });

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>SKU</TableHead>
            <TableHead>Item Name</TableHead>
            <TableHead className="text-center">Qty (Warehouse Sync)</TableHead>
            <TableHead>Price Scheme</TableHead>
            <TableHead className="text-right">Price</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grouped.map(({ id, name: category, items: catItems }) => (
            <React.Fragment key={id}>
              <TableRow className="bg-muted/40 font-bold border-t border-b">
                <TableCell colSpan={5} className="py-2.5 px-4 text-sm font-bold uppercase tracking-wider text-primary">
                  {category} <span className="text-xs font-normal text-muted-foreground ml-2">({catItems.length} items)</span>
                </TableCell>
              </TableRow>
              {catItems.map((i, idx) => {
                const stock = stockMap[i.productId] ?? 0;
                return (
                  <TableRow key={`${i.productId}-${idx}`}>
                    <TableCell className="font-mono text-xs">{i.sku}</TableCell>
                    <TableCell className="font-medium">{i.name}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={stock > 0 ? "secondary" : "outline"} className={stock === 0 ? "text-amber-600 border-amber-300" : ""}>
                        {stock} in stock
                      </Badge>
                    </TableCell>
                    <TableCell>{schemeLabel(i.priceType)}</TableCell>
                    <TableCell className="text-right font-bold text-sm">₱{i.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                  </TableRow>
                );
              })}
            </React.Fragment>
          ))}
          {!items.length && (
            <TableRow>
              <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                No items in this pricelist.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
