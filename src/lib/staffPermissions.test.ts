import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canVisit, canCreateAdmin, canManageUser, defaultPermissions, getSupplyChainViews, movementOptions, normalizePermissions, permissionsWithin, permitsMovement, resolvePermissions, rolePermissions, supplyChainViews } from './staffPermissions';
import type { StaffDelegation, UserProfile } from '../types';

const staff: UserProfile = { uid: 'staff-1', email: 'staff@example.test', displayName: 'Staff User', role: 'staff' };
test('role presets populate permissions and return independent warehouse selections', () => {
  const secretary = rolePermissions('secretary');
  assert.equal(secretary.inventory, 'adjust');
  assert.equal(secretary.orders, 'create');
  assert.equal(secretary.movementCreate, 'both');
  const agent = rolePermissions('agent');
  assert.equal(agent.inventory, 'view');
  assert.equal(agent.orders, 'create');
  assert.equal(agent.movementView, 'none');
  assert.deepEqual(agent.supplyChain, ['customers']);
  secretary.warehouseIds.push('warehouse-b');
  assert.deepEqual(rolePermissions('secretary').warehouseIds, []);
});
const grant: StaffDelegation = { id: 'grant-1', agentId: 'admin-1', staffEmail: staff.email, canAdjustInventory: true, canAdjustPricelist: true, createdAt: '', active: true,
  permissions: { ...defaultPermissions, inventory: 'adjust', pricelist: 'edit', orders: 'create', movementView: 'both', movementCreate: 'internal', warehouseAccess: 'selected', warehouseIds: ['main'] } };

test('saved secretary overrides take precedence over the role preset', () => {
  const custom = { ...rolePermissions('secretary'), orders: 'none' as const, inventory: 'view' as const, warehouseAccess: 'selected' as const, warehouseIds: ['warehouse-b'] };
  assert.deepEqual(resolvePermissions({ ...staff, role: 'secretary' }, { ...grant, permissions: custom }), custom);
  assert.equal(canVisit('/orders', custom), false);
});

test('creation never includes a movement type excluded from view access', () => {
  for (const [movementView] of movementOptions) for (const [movementCreate] of movementOptions) {
    const p = normalizePermissions({ ...defaultPermissions, movementView, movementCreate });
    for (const type of ['external', 'internal']) {
      if (permitsMovement(p.movementCreate, type)) assert.ok(permitsMovement(p.movementView, type));
    }
  }
});

test('deactivation removes elevated permissions and warehouse access without changing saved settings', () => {
  const revoked = { ...grant, active: false };
  const p = resolvePermissions(staff, revoked);
  assert.equal(p.inventory, 'view');
  assert.equal(p.pricelist, 'view');
  assert.equal(p.orders, 'none');
  assert.equal(p.movementCreate, 'none');
  assert.equal(p.warehouseAccess, 'selected');
  assert.deepEqual(p.warehouseIds, []);
  assert.deepEqual(resolvePermissions(staff, { ...revoked, active: true }), grant.permissions);
});

test('admin always retains full access, including with a stale or revoked delegation', () => {
  const admin: UserProfile = { ...staff, role: 'admin' };
  for (const delegation of [undefined, grant, { ...grant, active: false }]) {
    const permissions = resolvePermissions(admin, delegation);
    assert.equal(permissions.inventory, 'adjust');
    assert.equal(permissions.orders, 'create');
    assert.equal(permissions.warehouseAccess, 'all');
    assert.deepEqual(getSupplyChainViews(permissions.supplyChain), supplyChainViews);
  }
});

test('only admin can manage non-admin accounts and cannot revoke their own access', () => {
  const admin: UserProfile = { ...staff, uid: 'admin', role: 'admin' };
  assert.equal(canManageUser(admin, staff), true);
  assert.equal(canManageUser(admin, admin), false);
  assert.equal(canManageUser(admin, { ...admin, uid: 'another-admin' }), false);
  assert.equal(canManageUser(staff, admin), false);
  assert.equal(canManageUser(staff, { ...staff, uid: 'another-staff' }), false);
});

test('all eight Supply Chain combinations work independently of warehouse scope', () => {
  for (let mask = 0; mask < 8; mask++) {
    const views = supplyChainViews.filter((_, index) => mask & (1 << index));
    const permissions = normalizePermissions({ ...defaultPermissions, supplyChain: views, warehouseAccess: 'selected', warehouseIds: ['main'] });
    assert.deepEqual(getSupplyChainViews(permissions.supplyChain), views);
    assert.equal(canVisit('/supply-chain', permissions), mask !== 0);
    assert.deepEqual(permissions.warehouseIds, ['main']);
  }
  assert.deepEqual(getSupplyChainViews('all'), supplyChainViews);
  assert.deepEqual(getSupplyChainViews('customers'), ['customers']);
  assert.deepEqual(getSupplyChainViews('none'), []);
});

test('admins cannot delegate permissions or warehouses outside their own scope', () => {
  const limits = normalizePermissions({ ...defaultPermissions, supplyChain: ['customers', 'suppliers'], warehouseAccess: 'selected', warehouseIds: ['main'] });
  assert.equal(permissionsWithin(limits, limits), true);
  assert.equal(permissionsWithin({ ...limits, inventory: 'adjust' }, limits), false);
  assert.equal(permissionsWithin({ ...limits, orders: 'create' }, limits), false);
  assert.equal(permissionsWithin({ ...limits, supplyChain: ['warehouses'] }, limits), false);
  assert.equal(permissionsWithin({ ...limits, warehouseAccess: 'all' }, limits), false);
  assert.equal(permissionsWithin({ ...limits, warehouseIds: ['other'] }, limits), false);
  assert.equal(permissionsWithin({ ...limits, movementView: 'both' }, limits), false);
  assert.equal(permissionsWithin({ ...limits, pricelist: 'edit' }, limits), false);
});

test('old delegations still grant inventory and pricelist access', () => {
  const p = resolvePermissions(staff, { ...grant, permissions: undefined });
  assert.equal(p.inventory, 'adjust');
  assert.equal(p.pricelist, 'edit');
});

test('route access respects no access and view-only settings', () => {
  for (const path of ['/orders', '/transfers', '/supply-chain']) assert.equal(canVisit(path, defaultPermissions), false);
  assert.equal(canVisit('/orders', { ...defaultPermissions, orders: 'view' }), true);
  assert.equal(canVisit('/transfers', { ...defaultPermissions, movementView: 'internal' }), true);
  assert.equal(canVisit('/supply-chain', { ...defaultPermissions, supplyChain: 'warehouses' }), true);
});

test('warehouse selections are deduplicated and cleared for all-warehouse access', () => {
  assert.deepEqual(normalizePermissions({ ...defaultPermissions, warehouseAccess: 'selected', warehouseIds: ['main', 'main', 'sub'] }).warehouseIds, ['main', 'sub']);
  assert.deepEqual(normalizePermissions({ ...defaultPermissions, warehouseIds: ['main'] }).warehouseIds, []);
});

test('only the designated admin email can create another admin', () => {
  assert.equal(canCreateAdmin({ ...staff, role: 'admin', email: 'admin@example.com' }), true);
  assert.equal(canCreateAdmin({ ...staff, role: 'admin', email: ' ADMIN@example.com ' }), true);
  assert.equal(canCreateAdmin({ ...staff, role: 'admin', email: 'other@example.com' }), false);
  assert.equal(canCreateAdmin({ ...staff, role: 'agent', email: 'admin@example.com' }), false);
  assert.equal(canCreateAdmin(null), false);
});
