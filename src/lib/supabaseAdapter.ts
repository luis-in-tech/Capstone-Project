import { supabase } from './supabase';

export const db = {};
export const storage = supabase.storage;

export function collection(_db: any, path: string, ...rest: string[]) {
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

  // If pathOrId is provided and rest contains path segments / ID (e.g. doc(db, 'orders', '123') or 5-arg subcollection)
  if (rest.length > 0 && pathOrId) {
    const segments = [pathOrId, ...rest].join('/').split('/').filter(Boolean);
    if (segments.length === 2) {
      return { path: segments[0], id: segments[1] };
    }
    if (segments.length === 4 && segments[0] === 'orders' && segments[2] === 'items') {
      return {
        path: 'order_items',
        id: segments[3],
        parentField: 'orderId',
        parentId: segments[1],
        isSubcollection: true
      };
    }
    throw new Error(`Unsupported doc() path segments: ${segments.join('/')}`);
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
function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getLocalCollection(path: string): any[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const parsed = safeParseJson<unknown>(localStorage.getItem(`activepro_db_${path}`), []);
    const items: any[] = Array.isArray(parsed) ? [...parsed] : [];

    if (path === 'orders') {
      const overridesRaw = localStorage.getItem('activepro_order_overrides');
      const overrides = safeParseJson<unknown>(overridesRaw, null);
      if (typeof overrides === 'object' && overrides !== null && !Array.isArray(overrides)) {
        for (const [id, orderData] of Object.entries(overrides)) {
          if (typeof orderData !== 'object' || orderData === null || Array.isArray(orderData)) continue;
          const idx = items.findIndex((i: any) => i && (i.id || i.uid) === id);
          if (idx >= 0) {
            items[idx] = { ...items[idx], ...orderData, id };
          } else {
            items.push({ id, ...orderData });
          }
        }
      }
    }
    return items;
  } catch {
    return [];
  }
}

function saveLocalCollection(path: string, items: any[], notify = true) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(`activepro_db_${path}`, JSON.stringify(items));
    if (notify) {
      window.dispatchEvent(new CustomEvent('activepro_db_changed', { detail: { path } }));
    }
  } catch (e) {
    console.warn(`Failed to save local collection ${path}:`, e);
  }
}

export function saveLocalDoc(path: string, docData: any, notify = true) {
  const items = getLocalCollection(path);
  const safeItems = Array.isArray(items) ? items : [];
  const id = docData?.id || docData?.uid;
  const idx = id ? safeItems.findIndex((i: any) => i && (i.id || i.uid) === id) : -1;
  if (idx >= 0) {
    safeItems[idx] = { ...safeItems[idx], ...docData };
  } else {
    safeItems.unshift(docData);
  }
  saveLocalCollection(path, safeItems, notify);
}

export function deleteLocalDoc(path: string, docId: string) {
  const items = getLocalCollection(path);
  const safeItems = Array.isArray(items) ? items : [];
  const filtered = safeItems.filter((i: any) => i && (i.id || i.uid) !== docId);
  saveLocalCollection(path, filtered);

  if (path === 'orders' && typeof window !== 'undefined' && window.localStorage) {
    try {
      const overrides = safeParseJson<unknown>(localStorage.getItem('activepro_order_overrides'), null);
      if (typeof overrides === 'object' && overrides !== null && !Array.isArray(overrides)) {
        const record = overrides as Record<string, unknown>;
        if (docId in record) {
          delete record[docId];
          localStorage.setItem('activepro_order_overrides', JSON.stringify(record));
        }
      }
    } catch {}
  }
}

export function serverTimestamp() {
  return new Date().toISOString();
}

const MAX_PGRST204_RETRIES = 5;
let channelSeq = 0;

function isUidKeyedTable(path: string) {
  return path === 'users' || path === 'profiles';
}

const MISSING_RPC_CODES = new Set(['PGRST202', '42883', '42P01', 'PGRST205']);

export function isMissingRpcError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof err.code === 'string' ? err.code : '';
  if (MISSING_RPC_CODES.has(code)) return true;
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  return (
    (msg.includes('could not find the function') && msg.includes('schema cache')) ||
    (msg.includes('function') && msg.includes('does not exist'))
  );
}

export function clearLocalCaches() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('activepro_')) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access failures during logout cleanup
  }
}

function clearOrderOverride(docId?: string) {
  if (!docId || typeof window === 'undefined' || !window.localStorage) return;
  try {
    const overrides = safeParseJson<unknown>(localStorage.getItem('activepro_order_overrides'), null);
    if (typeof overrides === 'object' && overrides !== null && !Array.isArray(overrides)) {
      const record = overrides as Record<string, unknown>;
      if (docId in record) {
        delete record[docId];
        localStorage.setItem('activepro_order_overrides', JSON.stringify(record));
      }
    }
  } catch {}
}

async function executeWithMissingColumnRetry<T extends { error: any }>(
  initialPayload: Record<string, any>,
  tablePath: string,
  opLabel: string,
  runner: (payload: Record<string, any>) => Promise<T>,
): Promise<{ result: T; sanitized: Record<string, any> }> {
  let sanitized = { ...initialPayload };
  const stripped = new Set<string>();
  let result = await runner(sanitized);

  for (let attempt = 0; attempt < MAX_PGRST204_RETRIES; attempt++) {
    if (!result.error || result.error.code !== 'PGRST204') break;
    const match = result.error.message?.match(/Could not find the '([^']+)' column/i);
    const missingCol = match?.[1];
    if (!missingCol || !(missingCol in sanitized) || stripped.has(missingCol)) break;

    stripped.add(missingCol);
    const next = { ...sanitized };
    delete next[missingCol];
    if (Object.keys(next).length === 0) break;

    sanitized = next;
    console.warn(`Supabase ${opLabel} retry without unmigrated column '${missingCol}' for ${tablePath}`);
    result = await runner(sanitized);
  }

  return { result, sanitized };
}

export async function getDocs(q: any) {
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
  if (error) {
    throw error;
  }

  const finalData = Array.isArray(data) ? data : [];
  if (!q.isSubcollection && (!q.ops || q.ops.length === 0)) {
    saveLocalCollection(q.path, finalData, false);
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
  let isFetching = false;
  let hasPendingFetch = false;

  const fetchAndNotify = async () => {
    if (isFetching) {
      hasPendingFetch = true;
      return;
    }
    isFetching = true;
    try {
      const snap = await getDocs(q);
      if (!isUnmounted) callback(snap);
    } catch (e) {
      if (!isUnmounted) {
        if (errorCb) {
          errorCb(e);
        } else {
          console.warn(`Supabase onSnapshot error for ${q.path}:`, e);
        }
      }
    } finally {
      isFetching = false;
      if (hasPendingFetch && !isUnmounted) {
        hasPendingFetch = false;
        fetchAndNotify();
      }
    }
  };

  fetchAndNotify();

  const handleLocalChange = (e: any) => {
    if (!e.detail?.path || e.detail.path === q.path) {
      fetchAndNotify();
    }
  };

  const expectedStorageKey = `activepro_db_${q.path}`;
  const handleStorageChange = (e: StorageEvent) => {
    if (!e.key || e.key === expectedStorageKey || (q.path === 'orders' && e.key === 'activepro_order_overrides')) {
      fetchAndNotify();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('activepro_db_changed', handleLocalChange);
    window.addEventListener('storage', handleStorageChange);
  }

  const channel = supabase.channel(`public:${q.path}_${++channelSeq}_${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: q.path }, () => {
      fetchAndNotify();
    })
    .subscribe();

  return () => {
    isUnmounted = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('activepro_db_changed', handleLocalChange);
      window.removeEventListener('storage', handleStorageChange);
    }
    supabase.removeChannel(channel);
  };
}

interface ArrayUnionOp {
  __op: 'arrayUnion';
  elements: any[];
}

function isArrayUnionOp(val: unknown): val is ArrayUnionOp {
  return typeof val === 'object' && val !== null && (val as ArrayUnionOp).__op === 'arrayUnion' && Array.isArray((val as ArrayUnionOp).elements);
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

  try {
    const { result, sanitized } = await executeWithMissingColumnRetry(
      payload,
      col.path,
      'addDoc',
      async (candidate) => await supabase.from(col.path).insert([candidate]).select().single(),
    );
    const { data: res, error } = result as { data: any; error: any };
    if (error) {
      throw error;
    }

    const confirmed = res ? { ...sanitized, ...res } : sanitized;
    saveLocalDoc(col.path, confirmed, true);
    if (col.path === 'orders') clearOrderOverride(confirmed.id);
    return { id: confirmed.id };
  } catch (err) {
    console.warn(`Supabase addDoc write failed for ${col.path}:`, err);
    throw err;
  }
}

export async function updateDoc(docRef: any, data: any) {
  try {
    let resolvedData = { ...data };
    const unionEntries = Object.entries(resolvedData).filter(([, v]) => isArrayUnionOp(v));
    if (unionEntries.length > 0) {
      const existingSnap = await getDoc(docRef);
      const existingRow = existingSnap.data() || {};
      for (const [key, op] of unionEntries) {
        const unionOp = op as ArrayUnionOp;
        const current = Array.isArray(existingRow[key]) ? existingRow[key] : [];
        const merged = [...current];
        for (const el of unionOp.elements) {
          const exists = merged.some((cur) => JSON.stringify(cur) === JSON.stringify(el));
          if (!exists) merged.push(el);
        }
        resolvedData[key] = merged;
      }
    }

    const { result, sanitized } = await executeWithMissingColumnRetry(
      resolvedData,
      docRef.path,
      'updateDoc',
      async (candidate) => await supabase.from(docRef.path).update(candidate).eq('id', docRef.id).select(),
    );
    const error = result.error;
    const updatedRows = Array.isArray((result as { data?: unknown }).data) ? (result as { data: unknown[] }).data : [];

    if (error || updatedRows.length === 0) {
      if (isUidKeyedTable(docRef.path)) {
        const { result: uidResult, sanitized: uidSanitized } = await executeWithMissingColumnRetry(
          resolvedData,
          docRef.path,
          'updateDoc(uid)',
          async (candidate) => await supabase.from(docRef.path).update(candidate).eq('uid', docRef.id).select(),
        );
        const uidRows = Array.isArray((uidResult as { data?: unknown }).data) ? (uidResult as { data: unknown[] }).data : [];
        if (uidResult.error) {
          throw uidResult.error;
        }
        if (uidRows.length === 0) {
          throw new Error(`No matching record updated in ${docRef.path} (not found or access denied).`);
        }
        saveLocalDoc(docRef.path, { id: docRef.id, ...uidSanitized }, true);
        return;
      }
      if (error) throw error;
      throw new Error(`No matching record updated in ${docRef.path} (not found or access denied).`);
    }

    saveLocalDoc(docRef.path, { id: docRef.id, ...sanitized }, true);
    if (docRef.path === 'orders') clearOrderOverride(docRef.id);
  } catch (err) {
    console.warn(`Supabase updateDoc error on ${docRef.path}:`, err);
    throw err;
  }
}

export async function deleteDoc(docRef: any) {
  try {
    const { data, error } = await supabase.from(docRef.path).delete().eq('id', docRef.id).select();
    const deletedRows = Array.isArray(data) ? data : [];
    if (error || deletedRows.length === 0) {
      if (isUidKeyedTable(docRef.path)) {
        const { data: data2, error: err2 } = await supabase.from(docRef.path).delete().eq('uid', docRef.id).select();
        if (err2) {
          throw err2;
        }
        if (!Array.isArray(data2) || data2.length === 0) {
          throw new Error(`No matching record deleted in ${docRef.path} (not found or access denied).`);
        }
      } else {
        if (error) throw error;
        throw new Error(`No matching record deleted in ${docRef.path} (not found or access denied).`);
      }
    }
    deleteLocalDoc(docRef.path, docRef.id);
  } catch (err) {
    console.warn(`Supabase deleteDoc error on ${docRef.path}:`, err);
    throw err;
  }
}

export async function getDoc(docRef: any) {
  let { data: remoteData, error } = await supabase.from(docRef.path).select('*').eq('id', docRef.id).maybeSingle();
  if (error) {
    if (isUidKeyedTable(docRef.path)) {
      const { data: uidData, error: uidError } = await supabase.from(docRef.path).select('*').eq('uid', docRef.id).maybeSingle();
      if (uidError) throw uidError;
      remoteData = uidData;
    } else {
      throw error;
    }
  } else if (!remoteData && isUidKeyedTable(docRef.path)) {
    const { data: uidData, error: uidError } = await supabase.from(docRef.path).select('*').eq('uid', docRef.id).maybeSingle();
    if (uidError) throw uidError;
    remoteData = uidData;
  }

  if (remoteData) {
    saveLocalDoc(docRef.path, remoteData, false);
  }

  return {
    exists: () => !!remoteData,
    data: () => remoteData || null
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

  try {
    const { result, sanitized } = await executeWithMissingColumnRetry(
      payload,
      docRef.path,
      'setDoc',
      async (candidate) => await supabase.from(docRef.path).upsert([candidate]),
    );
    if (result.error) {
      throw result.error;
    }
    saveLocalDoc(docRef.path, sanitized, true);
    if (docRef.path === 'orders') clearOrderOverride(sanitized.id);
  } catch (err) {
    console.warn(`Supabase setDoc error on ${docRef.path}:`, err);
    throw err;
  }
}

export function ref(_storage: any, path: string) {
  return { path };
}

export async function uploadBytes(fileRef: any, file: File) {
  const { error } = await supabase.storage.from('activepro_assets').upload(fileRef.path, file, { upsert: true });
  if (error) throw error;
  return { ref: fileRef };
}

export async function getDownloadURL(fileRef: any) {
  const { data } = supabase.storage.from('activepro_assets').getPublicUrl(fileRef.path);
  return data.publicUrl;
}

export function arrayUnion(...elements: any[]): ArrayUnionOp {
  return { __op: 'arrayUnion', elements };
}
