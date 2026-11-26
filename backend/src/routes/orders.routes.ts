/**
 * @file orders.routes.ts
 * @description Express router for Orders & Order Entry endpoints.
 *
 * Routes:
 *   POST   /                          - Create a new order with items & stock reservation
 *   GET    /                          - List orders with filtering
 *   GET    /:id                       - Get single order by ID
 *   GET    /customer/:customerName/transactions - Get customer transaction history
 */

import { Router } from 'express';
import { requireRole } from '../middleware/rbac.middleware';
import * as ordersCtrl from '../controllers/orders.controller';

const router = Router();
router.use(requireRole(['admin', 'cmo', 'secretary']));

router.post('/', ordersCtrl.createOrder);
router.get('/', ordersCtrl.listOrders);
router.get('/customer/:customerName/transactions', ordersCtrl.getCustomerTransactions);
router.get('/:id', ordersCtrl.getOrderById);
router.post('/:id/cancel', ordersCtrl.cancelOrder);
router.patch('/:id/status', ordersCtrl.updateOrderStatus);

export default router;

