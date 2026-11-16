export type NotificationLinkTarget =
  | { kind: 'order'; id: string }
  | { kind: 'logistics'; id: string; routeId?: string; region?: string }
  | { kind: 'transfer'; id: string }
  | { kind: 'movement'; id: string }
  | { kind: 'warehouse'; id: string }
  | { kind: 'delegation'; id: string; email?: string; active?: boolean };

export function buildNotificationHref(target: NotificationLinkTarget): string {
  const params = new URLSearchParams();

  switch (target.kind) {
    case 'order':
      params.set('orderId', target.id);
      return `/orders?${params.toString()}`;

    case 'logistics':
      params.set('tab', 'consolidation');
      params.set('tripId', target.id);
      if (target.routeId) {
        params.set('routeId', target.routeId);
      } else if (target.region) {
        params.set('region', target.region);
      }
      return `/logistics?${params.toString()}`;

    case 'transfer':
      params.set('legacy', '1');
      params.set('transferId', target.id);
      return `/transfers?${params.toString()}`;

    case 'movement':
      params.set('movementId', target.id);
      return `/transfers?${params.toString()}`;

    case 'warehouse':
      params.set('view', 'warehouses');
      params.set('entityId', target.id);
      return `/supply-chain?${params.toString()}`;

    case 'delegation':
      params.set('delegationId', target.id);
      if (target.email) {
        params.set('email', target.email);
      }
      if (target.active === false) {
        params.set('status', 'all');
      }
      return `/delegation?${params.toString()}`;
  }
}

export function matchesOrderNotificationParam(
  order: { id: string; orderNumber?: string },
  param: string | null | undefined,
): boolean {
  const clean = param?.trim();
  if (!clean) return false;
  return order.id === clean || order.orderNumber === clean;
}

export function matchesMovementNotificationParam(
  movement: { id: string; movementNumber?: string },
  param: string | null | undefined,
): boolean {
  const clean = param?.trim();
  if (!clean) return false;
  return movement.id === clean || movement.movementNumber === clean;
}

export function routeMatchesNotificationParam(
  route: { routeId: string; region: string },
  dispatchKey: string,
  routeIdParam: string | null | undefined,
  regionParam: string | null | undefined,
): boolean {
  const cleanRouteId = routeIdParam?.trim();
  if (cleanRouteId) {
    if (
      route.routeId === cleanRouteId ||
      dispatchKey === cleanRouteId ||
      cleanRouteId.startsWith(`${route.routeId}::`)
    ) {
      return true;
    }
  }
  const cleanRegion = regionParam?.trim().toLowerCase();
  if (cleanRegion && route.region.trim().toLowerCase() === cleanRegion) {
    return true;
  }
  return false;
}

