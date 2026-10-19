import { supabase } from './supabase';

export const db = {};
export const storage = supabase.storage;

export function collection(db: any, path: string, ...rest: string[]) {
  let fullPath = path;
  if (rest.length > 0) {
    fullPath = [path, ...rest].join('/');
  }

  // Handle Firestore-style subcollection: orders/:orderId/items -> order_items
  const parts = fullPath.split('/').filter(Boolean);
  if (parts.length === 3 && parts[0] === 'orders' && parts[2] === 'items') {
    return {
      path: 'order_items',
      parentField: 'orderId',
      parentId: parts[1],
      isSubcollection: true
    };
  }

  // Normalize camelCase table names to matching Postgres tables if needed
  let normalizedPath = fullPath;
  if (normalizedPath === 'orderItems') normalizedPath = 'order_items';

  return { path: normalizedPath };
}

export function query(col: any, ...ops: any[]) {
  return { ...col, ops };
}

export function where(field: string, op: string, value: any) {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
  return { type: 'orderBy', field, dir };
}

export function limit(n: number) {
  return { type: 'limit', n };
}

export function doc(dbOrCol: any, pathOrId?: string, ...rest: string[]) {
  // Check if the first argument is a collection reference (e.g. doc(collection(db, 'orders')))
  if (dbOrCol && typeof dbOrCol.path === 'string') {
    // Generate a random ID if one isn't provided
    const autoId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
    return {
      path: dbOrCol.path,
      id: pathOrId || autoId,
      parentField: dbOrCol.parentField,
      parentId: dbOrCol.parentId,
      isSubcollection: dbOrCol.isSubcollection
    };
  }

  // If pathOrId is provided and rest contains the ID (e.g. doc(db, 'orders', '123'))
  if (rest.length > 0) {
    return { path: pathOrId, id: rest[0] };
  }

  // If path contains the ID (e.g. doc(db, 'orders/123'))
  if (pathOrId) {
    const parts = pathOrId.split('/').filter(Boolean);
    if (parts.length === 2) {
      return { path: parts[0], id: parts[1] };
    }
    // Handle doc(db, `orders/${orderId}/items/${itemId}`)
    if (parts.length === 4 && parts[0] === 'orders' && parts[2] === 'items') {
      return {
        path: 'order_items',
        id: parts[3],
        parentField: 'orderId',
        parentId: parts[1],
        isSubcollection: true
      };
    }
    // Fallback for doc(db, 'orders') - implicitly generate ID
    const autoId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
    return { path: pathOrId, id: autoId };
  }

  throw new Error("Invalid arguments to doc()");
}

// ── Local Persistence & Cross-Tab Synchronization ────────────────────────────
// Default P&L historical data for Jan-Mar 2025
export const DEFAULT_PL_EXPENSE_CATEGORIES = [
  { id: '00000000-0000-4000-c000-000000000001', name: 'Cost of Goods Sold', description: 'Direct material costs and supplier manufacturing costs', isActive: true },
  { id: '00000000-0000-4000-c000-000000000002', name: 'Freight and Shipping Costs', description: 'Outbound and inbound shipping freight adjustments', isActive: true },
  { id: '00000000-0000-4000-c000-000000000003', name: 'Office Supplies', description: 'Office and administrative consumables', isActive: true },
  { id: '00000000-0000-4000-c000-000000000004', name: 'Travel Expense', description: 'Field logistics, fleet transport, and travel expenditure', isActive: true },
  { id: '00000000-0000-4000-c000-000000000005', name: 'Utilities', description: 'Electricity, water, and facility operational utilities', isActive: true },
  { id: '00000000-0000-4000-c000-000000000006', name: 'Ask My Accountant', description: 'Professional auditing, CPA, and bookkeeping fees', isActive: true },
  { id: '00000000-0000-4000-c000-000000000007', name: 'OTHER EXPENSE', description: 'Miscellaneous general and administrative expenditures', isActive: true },
  { id: '00000000-0000-4000-c000-000000000008', name: 'Discounts & Allowances', description: 'Volume trade discounts and sales reductions', isActive: true },
];

export const DEFAULT_PL_ORDERS = [
  {
    id: '00000000-2025-0100-0000-000000000001',
    orderNumber: 'ORD-2025-01-PL',
    agentId: 'system',
    clientId: 'cli_pl_jan25',
    clientName: 'Commercial Operations (Jan 2025 P&L)',
    status: 'completed',
    totalAmount: 8118370.93,
    paymentStatus: 'paid',
    deliveryRegion: 'Metro Manila',
    createdAt: '2025-01-31T23:59:59.000Z',
    updatedAt: '2025-01-31T23:59:59.000Z',
  },
  {
    id: '00000000-2025-0200-0000-000000000002',
    orderNumber: 'ORD-2025-02-PL',
    agentId: 'system',
    clientId: 'cli_pl_feb25',
    clientName: 'Commercial Operations (Feb 2025 P&L)',
    status: 'completed',
    totalAmount: 7073596.25,
    paymentStatus: 'paid',
    deliveryRegion: 'Metro Manila',
    createdAt: '2025-02-28T23:59:59.000Z',
    updatedAt: '2025-02-28T23:59:59.000Z',
  },
  {
    id: '00000000-2025-0300-0000-000000000003',
    orderNumber: 'ORD-2025-03-PL',
    agentId: 'system',
    clientId: 'cli_pl_mar25',
    clientName: 'Commercial Operations (Mar 2025 P&L)',
    status: 'completed',
    totalAmount: 6310386.22,
    paymentStatus: 'paid',
    deliveryRegion: 'Metro Manila',
    createdAt: '2025-03-31T23:59:59.000Z',
    updatedAt: '2025-03-31T23:59:59.000Z',
  },
];

export const DEFAULT_PL_EXPENSES = [
  // Jan 2025
  { id: '00000000-2025-0100-e000-000000000001', category: 'Cost of Goods Sold', amount: 5904520.17, description: 'Jan 2025 Direct Cost of Goods Sold', date: '2025-01-31T20:00:00.000Z', recordedBy: 'accountant', orderId: '00000000-2025-0100-0000-000000000001' },
  { id: '00000000-2025-0100-e000-000000000002', category: 'Freight and Shipping Costs', amount: -405.00, description: 'Jan 2025 Freight and Shipping Cost Adjustment', date: '2025-01-31T20:10:00.000Z', recordedBy: 'accountant', orderId: '00000000-2025-0100-0000-000000000001' },
  { id: '00000000-2025-0100-e000-000000000003', category: 'Office Supplies', amount: -230.00, description: 'Jan 2025 Office Supplies Credit Adjustment', date: '2025-01-31T20:20:00.000Z', recordedBy: 'accountant' },
  { id: '00000000-2025-0100-e000-000000000004', category: 'Travel Expense', amount: 2500.00, description: 'Jan 2025 Operational Travel Expense', date: '2025-01-31T20:30:00.000Z', recordedBy: 'accountant' },
  { id: '00000000-2025-0100-e000-000000000005', category: 'Utilities', amount: 0.00, description: 'Jan 2025 Facility Utilities', date: '2025-01-31T20:40:00.000Z', recordedBy: 'accountant' },
  { id: '00000000-2025-0100-e000-000000000006', category: 'Ask My Accountant', amount: -2515.17, description: 'Jan 2025 CPA & Accountant Reconciled Credit', date: '2025-01-31T20:50:00.000Z', recordedBy: 'accountant' },
  { id: '00000000-2025-0100-e000-000000000007', category: 'OTHER EXPENSE', amount: 12670.27, description: 'Jan 2025 General Operational & Other Expense', date: '2025-01-31T21:00:00.000Z', recordedBy: 'accountant' },

  // Feb 2025
  { id: '00000000-2025-0200-e000-000000000001', category: 'Cost of Goods Sold', amount: 6100297.72, description: 'Feb 2025 Direct Cost of Goods Sold', date: '2025-02-28T20:00:00.000Z', recordedBy: 'accountant', orderId: '00000000-2025-0200-0000-000000000002' },
  { id: '00000000-2025-0200-e000-000000000002', category: 'Freight and Shipping Costs', amount: -185.00, description: 'Feb 2025 Freight and Shipping Cost Adjustment', date: '2025-02-28T20:10:00.000Z', recordedBy: 'accountant', orderId: '00000000-2025-0200-0000-000000000002' },
  { id: '00000000-2025-0200-e000-000000000003', category: 'Office Supplies', amount: -345.00, description: 'Feb 2025 Office Supplies Credit Adjustment', date: '2025-02-28T20:20:00.000Z', recordedBy: 'accountant' },
  { id: '00000000-2025-0200-e000-000000000004', category: 'Travel Expense', amount: 9000.00, description: 'Feb 2025 Operational Travel & Logistics Expense', date: '2025-02-28T20:30:00.000Z', recordedBy: 'accountant' },
  { id: '00000000-2025-0200-e000-000000000005', category: 'Utilities', amount: 0.00, description: 'Feb 2025 Facility Utilities', date: '2025-02-28T20:40:00.000Z', recordedBy: 'accountant' },
  { id: '00000000-2025-0200-e000-000000000006', category: 'Ask My Accountant', amount: -13735.76, description: 'Feb 2025 Accountant Audit Adjustments (Credit)', date: '2025-02-28T20:50:00.000Z', recordedBy: 'accountant' },
  { id: '00000000-2025-0200-e000-000000000007', category: 'OTHER EXPENSE', amount: 4000.00, description: 'Feb 2025 General Operational & Other Expense', date: '2025-02-28T21:00:00.000Z', recordedBy: 'accountant' },

  // Mar 2025
  { id: '00000000-2025-0300-e000-000000000001', category: 'Cost of Goods Sold', amount: 5082247.40, description: 'Mar 2025 Direct Cost of Goods Sold', date: '2025-03-31T20:00:00.000Z', recordedBy: 'accountant', orderId: '00000000-2025-0300-0000-000000000003' },
  { id: '00000000-2025-0300-e000-000000000002', category: 'Freight and Shipping Costs', amount: -640.00, description: 'Mar 2025 Freight and Shipping Cost Adjustment', date: '2025-03-31T20:10:00.000Z', recordedBy: 'accountant', orderId: '00000000-2025-0300-0000-000000000003' },
  { id: '00000000-2025-0300-e000-000000000003', category: 'Office Supplies', amount: -690.00, description: 'Mar 2025 Office Supplies Credit Adjustment', date: '2025-03-31T20:20:00.000Z', recordedBy: 'accountant' },
  { id: '00000000-2025-0300-e000-000000000004', category: 'Travel Expense', amount: 3000.00, description: 'Mar 2025 Operational Travel Expense', date: '2025-03-31T20:30:00.000Z', recordedBy: 'accountant' },
  { id: '00000000-2025-0300-e000-000000000005', category: 'Utilities', amount: 0.00, description: 'Mar 2025 Facility Utilities', date: '2025-03-31T20:40:00.000Z', recordedBy: 'accountant' },
  { id: '00000000-2025-0300-e000-000000000006', category: 'Ask My Accountant', amount: -2611.22, description: 'Mar 2025 Accountant Reconciliation Credit', date: '2025-03-31T20:50:00.000Z', recordedBy: 'accountant' },
  { id: '00000000-2025-0300-e000-000000000007', category: 'OTHER EXPENSE', amount: 25710.23, description: 'Mar 2025 General Operational & Other Expense', date: '2025-03-31T21:00:00.000Z', recordedBy: 'accountant' },
];

function getLocalCollection(path: string): any[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(`activepro_db_${path}`);
    const items = raw ? JSON.parse(raw) : [];

    // Pre-populate with default P&L historical records if empty or missing
    if (path === 'expenses') {
      for (const defExp of DEFAULT_PL_EXPENSES) {
        if (!items.some((i: any) => (i.id || i.uid) === defExp.id)) {
          items.push(defExp);
        }
      }
    } else if (path === 'expenseCategories') {
      for (const defCat of DEFAULT_PL_EXPENSE_CATEGORIES) {
        if (!items.some((i: any) => (i.id || i.uid) === defCat.id || i.name === defCat.name)) {
          items.push(defCat);
        }
      }
    } else if (path === 'orders') {
      for (const defOrd of DEFAULT_PL_ORDERS) {
        if (!items.some((i: any) => (i.id || i.uid) === defOrd.id)) {
          items.push(defOrd);
        }
      }

      // Also merge any existing activepro_order_overrides if path === 'orders'
      const overridesRaw = localStorage.getItem('activepro_order_overrides');
      if (overridesRaw) {
        const overrides = JSON.parse(overridesRaw);
        for (const [id, orderData] of Object.entries(overrides)) {
          if (!items.some((i: any) => (i.id || i.uid) === id)) {
            items.push({ id, ...(orderData as any) });
          }
        }
      }
    }
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function saveLocalCollection(path: string, items: any[]) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(`activepro_db_${path}`, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('activepro_db_changed', { detail: { path } }));
  } catch (e) {
    console.warn(`Failed to save local collection ${path}:`, e);
  }
}

function saveLocalDoc(path: string, docData: any) {
  const items = getLocalCollection(path);
  const id = docData.id || docData.uid;
  const idx = items.findIndex((i: any) => (i.id || i.uid) === id);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...docData };
  } else {
    items.unshift(docData);
  }
  saveLocalCollection(path, items);

  if (path === 'orders' && id && typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = localStorage.getItem('activepro_order_overrides');
      const overrides = raw ? JSON.parse(raw) : {};
      overrides[id] = { ...(overrides[id] || {}), ...docData };
      localStorage.setItem('activepro_order_overrides', JSON.stringify(overrides));
    } catch {}
  }
}

function deleteLocalDoc(path: string, docId: string) {
  const items = getLocalCollection(path);
  const filtered = items.filter((i: any) => (i.id || i.uid) !== docId);
  saveLocalCollection(path, filtered);

  if (path === 'orders' && typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = localStorage.getItem('activepro_order_overrides');
      if (raw) {
        const overrides = JSON.parse(raw);
        if (overrides[docId]) {
          delete overrides[docId];
          localStorage.setItem('activepro_order_overrides', JSON.stringify(overrides));
        }
      }
    } catch {}
  }
}

export function serverTimestamp() {
  return new Date().toISOString();
}

export async function getDocs(q: any) {
  let remoteData: any[] = [];
  try {
    let builder: any = supabase.from(q.path).select('*');
    if (q.isSubcollection && q.parentField && q.parentId) {
      builder = builder.eq(q.parentField, q.parentId);
    }
    if (q.ops) {
      for (const op of q.ops) {
        if (op.type === 'where') {
          if (op.op === '==') builder = builder.eq(op.field, op.value);
          if (op.op === '!=') builder = builder.neq(op.field, op.value);
          if (op.op === '>') builder = builder.gt(op.field, op.value);
          if (op.op === '>=') builder = builder.gte(op.field, op.value);
          if (op.op === '<') builder = builder.lt(op.field, op.value);
          if (op.op === '<=') builder = builder.lte(op.field, op.value);
          if (op.op === 'in') builder = builder.in(op.field, op.value);
          if (op.op === 'array-contains') builder = builder.contains(op.field, [op.value]);
        }
        if (op.type === 'orderBy') {
          builder = builder.order(op.field, { ascending: op.dir === 'asc' });
        }
        if (op.type === 'limit') {
          builder = builder.limit(op.n);
        }
      }
    }
    const { data, error } = await builder;
    if (!error && Array.isArray(data)) {
      remoteData = data;
    }
  } catch (err) {
    console.warn(`Supabase fetch failed for ${q.path}, utilizing local persistent records:`, err);
  }

  // Merge remote data with local persistent cache
  const localItems = getLocalCollection(q.path);
  const mergedMap = new Map<string, any>();

  for (const item of remoteData) {
    const id = item.id || item.uid;
    if (id) mergedMap.set(id, item);
  }

  for (const item of localItems) {
    const id = item.id || item.uid;
    if (id) {
      const existing = mergedMap.get(id);
      mergedMap.set(id, existing ? { ...existing, ...item } : item);
    }
  }

  let finalData = Array.from(mergedMap.values());

  // Filter if subcollection
  if (q.isSubcollection && q.parentField && q.parentId) {
    finalData = finalData.filter((item: any) => item[q.parentField] === q.parentId);
  }

  // Apply in-memory where ops
  if (q.ops) {
    for (const op of q.ops) {
      if (op.type === 'where') {
        if (op.op === '==') finalData = finalData.filter((item: any) => item[op.field] === op.value);
        if (op.op === '!=') finalData = finalData.filter((item: any) => item[op.field] !== op.value);
        if (op.op === '>') finalData = finalData.filter((item: any) => item[op.field] > op.value);
        if (op.op === '>=') finalData = finalData.filter((item: any) => item[op.field] >= op.value);
        if (op.op === '<') finalData = finalData.filter((item: any) => item[op.field] < op.value);
        if (op.op === '<=') finalData = finalData.filter((item: any) => item[op.field] <= op.value);
      }
    }
  }

  return {
    docs: finalData.map((d: any) => ({
      id: d.id || d.uid,
      data: () => d
    })),
    empty: finalData.length === 0
  };
}

export function onSnapshot(q: any, callback: (snap: any) => void, errorCb?: (e: any) => void) {
  let isUnmounted = false;

  const fetchAndNotify = async () => {
    try {
      const snap = await getDocs(q);
      if (!isUnmounted) callback(snap);
    } catch (e) {
      if (!isUnmounted && errorCb) errorCb(e);
    }
  };

  fetchAndNotify();

  const handleLocalChange = (e: any) => {
    if (!e.detail?.path || e.detail.path === q.path) {
      fetchAndNotify();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('activepro_db_changed', handleLocalChange);
    window.addEventListener('storage', fetchAndNotify);
  }

  const channel = supabase.channel(`public:${q.path}_${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: q.path }, () => {
      fetchAndNotify();
    })
    .subscribe();

  return () => {
    isUnmounted = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('activepro_db_changed', handleLocalChange);
      window.removeEventListener('storage', fetchAndNotify);
    }
    supabase.removeChannel(channel);
  };
}

export async function addDoc(col: any, data: any) {
  const autoId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
  const payload = {
    id: data.id || autoId,
    ...data,
    ...(col.parentField && col.parentId && !data[col.parentField]
      ? { [col.parentField]: col.parentId }
      : {})
  };

  // 1. Immediately persist locally so records never disappear
  saveLocalDoc(col.path, payload);

  // 2. Sync to Supabase in background
  try {
    const { data: res, error } = await supabase.from(col.path).insert([payload]).select().single();
    if (!error && res?.id) {
      payload.id = res.id;
      saveLocalDoc(col.path, payload);
      return { id: res.id };
    }
  } catch (err) {
    console.warn(`Supabase addDoc write failed for ${col.path}, stored locally:`, err);
  }

  return { id: payload.id };
}

export async function updateDoc(docRef: any, data: any) {
  saveLocalDoc(docRef.path, { id: docRef.id, ...data });

  try {
    const { error } = await supabase.from(docRef.path).update(data).eq('id', docRef.id);
    if (error) {
      const { error: err2 } = await supabase.from(docRef.path).update(data).eq('uid', docRef.id);
      if (err2) console.warn(`Supabase updateDoc fallback for ${docRef.path}:`, err2);
    }
  } catch (err) {
    console.warn(`Supabase updateDoc error on ${docRef.path}, preserved locally:`, err);
  }
}

export async function deleteDoc(docRef: any) {
  deleteLocalDoc(docRef.path, docRef.id);

  try {
    const { error } = await supabase.from(docRef.path).delete().eq('id', docRef.id);
    if (error) {
      const { error: err2 } = await supabase.from(docRef.path).delete().eq('uid', docRef.id);
      if (err2) console.warn(`Supabase deleteDoc fallback for ${docRef.path}:`, err2);
    }
  } catch (err) {
    console.warn(`Supabase deleteDoc error on ${docRef.path}:`, err);
  }
}

export async function getDoc(docRef: any) {
  // Check local store first
  const localItems = getLocalCollection(docRef.path);
  const localMatch = localItems.find((i: any) => (i.id || i.uid) === docRef.id);

  let data = localMatch || null;
  try {
    let { data: remoteData, error } = await supabase.from(docRef.path).select('*').eq('id', docRef.id).maybeSingle();
    if (error || !remoteData) {
      const { data: uidData, error: uidError } = await supabase.from(docRef.path).select('*').eq('uid', docRef.id).maybeSingle();
      if (!uidError && uidData) {
        remoteData = uidData;
      }
    }
    if (remoteData) {
      data = localMatch ? { ...remoteData, ...localMatch } : remoteData;
    }
  } catch (err) {
    console.warn(`Supabase getDoc failed for ${docRef.path}/${docRef.id}, using local:`, err);
  }

  return {
    exists: () => !!data,
    data: () => data
  };
}

export async function setDoc(docRef: any, data: any) {
  const payload = {
    id: data.id || docRef.id,
    ...data,
    ...(docRef.parentField && docRef.parentId && !data[docRef.parentField]
      ? { [docRef.parentField]: docRef.parentId }
      : {})
  };

  // 1. Immediately persist locally so records never disappear
  saveLocalDoc(docRef.path, payload);

  // 2. Sync to Supabase in background
  try {
    const { error } = await supabase.from(docRef.path).upsert([payload]);
    if (error) {
      console.warn(`Supabase setDoc failed for ${docRef.path}, stored locally:`, error);
    }
  } catch (err) {
    console.warn(`Supabase setDoc exception for ${docRef.path}, stored locally:`, err);
  }
}

export function ref(storage: any, path: string) { 
  return { path }; 
}

export async function uploadBytes(ref: any, file: File) {
  const { data, error } = await supabase.storage.from('activepro_assets').upload(ref.path, file, { upsert: true });
  if (error) throw error;
  return { ref };
}

export async function getDownloadURL(ref: any) {
  const { data } = supabase.storage.from('activepro_assets').getPublicUrl(ref.path);
  return data.publicUrl;
}

export function writeBatch(db: any) {
  const operations: any[] = [];
  return {
    set: (ref: any, data: any) => operations.push({ type: 'set', ref, data }),
    update: (ref: any, data: any) => operations.push({ type: 'update', ref, data }),
    delete: (ref: any) => operations.push({ type: 'delete', ref }),
    commit: async () => {
      // Execute sequentially as a fallback for batch
      for (const op of operations) {
        if (op.type === 'set') await setDoc(op.ref, op.data);
        if (op.type === 'update') await updateDoc(op.ref, op.data);
        if (op.type === 'delete') await deleteDoc(op.ref);
      }
    }
  };
}

export function arrayUnion(...elements: any[]) {
  // In Supabase, appending to a JSONB array or Postgres array needs a different approach.
  // For the sake of the adapter, we will return a special object that could be handled if needed,
  // but usually it's just passed as data.
  return elements;
}
