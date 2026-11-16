import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildNotificationHref,
  matchesMovementNotificationParam,
  matchesOrderNotificationParam,
  routeMatchesNotificationParam,
} from './notificationLinks';

test('buildNotificationHref produces record-specific deep links without mutating paths', () => {
  assert.equal(buildNotificationHref({ kind: 'order', id: 'ord-123' }), '/orders?orderId=ord-123');
  assert.equal(
    buildNotificationHref({
      kind: 'logistics',
      id: 'trip-9',
      routeId: 'route-north::ord-1,ord-2',
      region: 'Metro Manila',
    }),
    '/logistics?tab=consolidation&tripId=trip-9&routeId=route-north%3A%3Aord-1%2Cord-2',
  );
  assert.equal(
    buildNotificationHref({ kind: 'logistics', id: 'trip-10', region: 'Luzon' }),
    '/logistics?tab=consolidation&tripId=trip-10&region=Luzon',
  );
  assert.equal(
    buildNotificationHref({ kind: 'transfer', id: 'tr-55' }),
    '/transfers?legacy=1&transferId=tr-55',
  );
  assert.equal(
    buildNotificationHref({ kind: 'movement', id: 'mov-77' }),
    '/transfers?movementId=mov-77',
  );
  assert.equal(
    buildNotificationHref({ kind: 'warehouse', id: 'wh-manila' }),
    '/supply-chain?view=warehouses&entityId=wh-manila',
  );
  assert.equal(
    buildNotificationHref({ kind: 'delegation', id: 'del-1', email: 'staff@activepro.ph', active: true }),
    '/delegation?delegationId=del-1&email=staff%40activepro.ph',
  );
  assert.equal(
    buildNotificationHref({ kind: 'delegation', id: 'del-2', email: 'revoked@activepro.ph', active: false }),
    '/delegation?delegationId=del-2&email=revoked%40activepro.ph&status=all',
  );
});

test('matchesOrderNotificationParam and matchesMovementNotificationParam match IDs and display numbers', () => {
  assert.equal(matchesOrderNotificationParam({ id: 'uuid-1', orderNumber: 'ORD-2611150001' }, 'uuid-1'), true);
  assert.equal(matchesOrderNotificationParam({ id: 'uuid-1', orderNumber: 'ORD-2611150001' }, 'ORD-2611150001'), true);
  assert.equal(matchesOrderNotificationParam({ id: 'uuid-1', orderNumber: 'ORD-2611150001' }, 'uuid-2'), false);
  assert.equal(matchesOrderNotificationParam({ id: 'uuid-1', orderNumber: 'ORD-2611150001' }, ''), false);

  assert.equal(matchesMovementNotificationParam({ id: 'mov-1', movementNumber: 'MV-0009' }, 'mov-1'), true);
  assert.equal(matchesMovementNotificationParam({ id: 'mov-1', movementNumber: 'MV-0009' }, 'MV-0009'), true);
  assert.equal(matchesMovementNotificationParam({ id: 'mov-1', movementNumber: 'MV-0009' }, 'MV-0010'), false);
});

test('routeMatchesNotificationParam matches direct routeId, compound dispatchKey, or region fallback', () => {
  const route = { routeId: 'route-ncr-1', region: 'Metro Manila' };
  const dispatchKey = 'route-ncr-1::ord-1,ord-2';

  assert.equal(routeMatchesNotificationParam(route, dispatchKey, 'route-ncr-1', null), true);
  assert.equal(routeMatchesNotificationParam(route, dispatchKey, 'route-ncr-1::ord-1,ord-2', null), true);
  assert.equal(routeMatchesNotificationParam(route, dispatchKey, 'route-ncr-1::older-ord', null), true);
  assert.equal(routeMatchesNotificationParam(route, dispatchKey, 'route-other', 'metro manila'), true);
  assert.equal(routeMatchesNotificationParam(route, dispatchKey, 'route-other', 'Visayas'), false);
});

