export interface QueryOp {
  type: 'where' | 'orderBy' | 'limit';
  field?: string;
  op?: string;
  value?: unknown;
  dir?: 'asc' | 'desc';
  n?: number;
}

export interface QueryDescriptor {
  path: string;
  isSubcollection?: boolean;
  parentField?: string;
  parentId?: string;
  ops?: QueryOp[];
}

export function buildQueryCacheKey(q: QueryDescriptor): string {
  const normalizedOps = Array.isArray(q.ops)
    ? q.ops.map((op) => {
        if (op.type === 'where') {
          return ['w', op.field ?? '', op.op ?? '', op.value ?? null];
        }
        if (op.type === 'orderBy') {
          return ['o', op.field ?? '', op.dir ?? 'asc'];
        }
        if (op.type === 'limit') {
          return ['l', op.n ?? null];
        }
        return [op.type];
      })
    : [];

  return JSON.stringify({
    path: q.path,
    sub: Boolean(q.isSubcollection),
    pf: q.parentField ?? null,
    pid: q.parentId ?? null,
    ops: normalizedOps,
  });
}

