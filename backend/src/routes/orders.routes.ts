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
import * as ordersCtrl from '../controllers/orders.controller';

const router = Router();

router.post('/', ordersCtrl.createOrder);
router.get('/', ordersCtrl.listOrders);
router.get('/:id', ordersCtrl.getOrderById);
router.get('/customer/:customerName/transactions', ordersCtrl.getCustomerTransactions);

export default router;
