const prefetchedRoutes = new Set<string>();

type RouteLoader = () => Promise<unknown>;

const ROUTE_LOADERS: Record<string, RouteLoader> = {
  '/auth': () => import('../components/Auth'),
  '/about': () => import('../components/About'),
  '/onboarding': () => import('../components/Onboarding'),
  '/privacy': () => import('../components/Privacy'),
  '/terms': () => import('../components/Terms'),
  '/dashboard': () => import('../components/Dashboard'),
  '/inventory': () => import('../components/Inventory'),
  '/supply-chain': () => import('../components/SupplyChain'),
  '/orders': () => import('../components/Orders'),
  '/transfers': () => import('../components/InventoryMovement'),
  '/finance': () => import('../components/Finance'),
  '/settings': () => import('../components/Settings'),
  '/logistics': () => import('../components/LogisticsOptimizer'),
  '/pricelist': () => import('../components/Pricelist'),
  '/admin': () => import('../components/AdminPanel'),
  '/delegation': () => import('../components/DelegationPanel'),
};

export function resolveRoutePrefetchKey(pathname: string): string | null {
  const cleanPath = (pathname || '/').split('?')[0].split('#')[0];
  if (cleanPath === '/' || cleanPath === '') return '/auth';
  if (cleanPath in ROUTE_LOADERS) return cleanPath;
  const matchedPrefix = Object.keys(ROUTE_LOADERS).find(
    (prefix) => cleanPath.startsWith(`${prefix}/`),
  );
  return matchedPrefix ?? null;
}

export function preloadRoute(
  pathname: string,
  loaders: Record<string, RouteLoader> = ROUTE_LOADERS,
  seen: Set<string> = prefetchedRoutes,
): boolean {
  const key = resolveRoutePrefetchKey(pathname);
  if (!key || seen.has(key)) return false;
  const loader = loaders[key];
  if (!loader) return false;
  seen.add(key);
  void loader().catch(() => {
    seen.delete(key);
  });
  return true;
}

