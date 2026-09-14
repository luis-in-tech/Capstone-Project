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
    const autoId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
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
    const autoId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
    return { path: pathOrId, id: autoId };
  }

  throw new Error("Invalid arguments to doc()");
}

export function serverTimestamp() {
  return new Date().toISOString();
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
  if (error) throw error;
  return {
    docs: (data || []).map((d: any) => ({
      id: d.id || d.uid,
      data: () => d
    })),
    empty: !data || data.length === 0
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

  const channel = supabase.channel(`public:${q.path}_${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: q.path }, () => {
      fetchAndNotify();
    })
    .subscribe();

  return () => {
    isUnmounted = true;
    supabase.removeChannel(channel);
  };
}

export async function addDoc(col: any, data: any) {
  const payload = {
    ...data,
    ...(col.parentField && col.parentId && !data[col.parentField]
      ? { [col.parentField]: col.parentId }
      : {})
  };
  const { data: res, error } = await supabase.from(col.path).insert([payload]).select().single();
  if (error) throw error;
  return { id: res?.id || 'new-id' };
}

export async function updateDoc(docRef: any, data: any) {
  const { error } = await supabase.from(docRef.path).update(data).eq('id', docRef.id);
  if (error) {
    const { error: err2 } = await supabase.from(docRef.path).update(data).eq('uid', docRef.id);
    if (err2) throw err2;
  }
}

export async function deleteDoc(docRef: any) {
  const { error } = await supabase.from(docRef.path).delete().eq('id', docRef.id);
  if (error) {
    const { error: err2 } = await supabase.from(docRef.path).delete().eq('uid', docRef.id);
    if (err2) throw err2;
  }
}

export async function getDoc(docRef: any) {
  const { data, error } = await supabase.from(docRef.path).select('*').eq('uid', docRef.id).single();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 is no rows
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
  const { error } = await supabase.from(docRef.path).upsert([payload]);
  if (error) throw error;
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
