import type { MovementAccess, StaffDelegation, StaffPermissions, SupplyChainView, UserProfile } from '../types';

export const supplyChainViews: SupplyChainView[] = ['customers', 'suppliers', 'warehouses'];
export function getSupplyChainViews(value: StaffPermissions['supplyChain']): SupplyChainView[] {
  return supplyChainViews.filter(view => value === 'all' || (Array.isArray(value) ? value.includes(view) : value === view));
}
export const hasAdminRole = (profile: UserProfile | null) => profile?.role === 'admin';
export function canManageUser(actor: UserProfile | null, target: UserProfile) {
  return hasAdminRole(actor) && actor?.uid !== target.uid && target.role !== 'admin';
}

export const defaultPermissions: StaffPermissions = {
  inventory: 'view', pricelist: 'view', orders: 'none', movementView: 'none',
  movementCreate: 'none', supplyChain: [], warehouseAccess: 'all', warehouseIds: [],
};
export function rolePermissions(role: UserProfile['role']): StaffPermissions {
  const base = { ...defaultPermissions, supplyChain: [], warehouseIds: [] };
  if (role === 'admin') return { ...base, inventory: 'adjust', pricelist: 'edit', orders: 'create', movementView: 'both', movementCreate: 'both', supplyChain: [...supplyChainViews] };
  if (role === 'secretary') return { ...base, inventory: 'adjust', orders: 'create', movementView: 'both', movementCreate: 'both', supplyChain: [...supplyChainViews] };
  if (role === 'agent') return { ...base, orders: 'create', supplyChain: ['customers'] };
  return base;
}
export const movementOptions = [['none', 'No access'], ['external', 'External only'], ['internal', 'Internal only'], ['both', 'Both']] as const;
export const permitsMovement = (scope: MovementAccess, type: string) => scope === 'both' || scope === type;
export function normalizePermissions(value: StaffPermissions): StaffPermissions {
  const movementCreate = value.movementCreate === 'none' || value.movementView === 'both' || value.movementCreate === value.movementView ? value.movementCreate : 'none';
  return { ...value, supplyChain: getSupplyChainViews(value.supplyChain), movementCreate, warehouseIds: value.warehouseAccess === 'all' ? [] : [...new Set(value.warehouseIds)] };
}
export function resolvePermissions(profile: UserProfile | null, delegation?: StaffDelegation): StaffPermissions {
  if (profile?.role === 'admin') return { ...defaultPermissions, inventory: 'adjust', pricelist: 'edit', orders: 'create', movementView: 'both', movementCreate: 'both', supplyChain: [...supplyChainViews] };
  if (delegation?.active === false) return { ...defaultPermissions, warehouseAccess: 'selected' };
  if (delegation?.permissions) return normalizePermissions(delegation.permissions);
  return { ...defaultPermissions, inventory: delegation?.canAdjustInventory ? 'adjust' : 'view', pricelist: delegation?.canAdjustPricelist ? 'edit' : 'view',
    orders: profile?.role === 'staff' ? 'none' : 'create', movementView: profile?.role === 'secretary' ? 'both' : 'none', movementCreate: profile?.role === 'secretary' ? 'both' : 'none' };
}
export function canVisit(path: string, permissions: StaffPermissions) {
  if (path === '/orders') return permissions.orders !== 'none';
  if (path === '/transfers') return permissions.movementView !== 'none';
  if (path === '/supply-chain') return getSupplyChainViews(permissions.supplyChain).length > 0;
  return true;
}

// Compare module and warehouse permissions. Admins have unrestricted access.
export function permissionsWithin(permissions: StaffPermissions, limits: StaffPermissions) {
  return (permissions.inventory !== 'adjust' || limits.inventory === 'adjust')
    && (permissions.pricelist !== 'edit' || limits.pricelist === 'edit')
    && ['none', 'view', 'create'].indexOf(permissions.orders) <= ['none', 'view', 'create'].indexOf(limits.orders)
    && ['external', 'internal'].every(type => (!permitsMovement(permissions.movementView, type) || permitsMovement(limits.movementView, type)) && (!permitsMovement(permissions.movementCreate, type) || permitsMovement(limits.movementCreate, type)))
    && getSupplyChainViews(permissions.supplyChain).every(view => getSupplyChainViews(limits.supplyChain).includes(view))
    && (limits.warehouseAccess === 'all' || (permissions.warehouseAccess === 'selected' && permissions.warehouseIds.every(id => limits.warehouseIds.includes(id))));
}

export const canCreateAdmin = (profile: UserProfile | null) => profile?.role === 'admin' && profile.email.trim().toLowerCase() === 'admin@example.com';
