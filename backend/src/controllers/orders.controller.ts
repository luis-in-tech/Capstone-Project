/**
 * @file orders.controller.ts
 * @description Express controller handlers for the Orders API.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import * as ordersService from '../services/orders.service';
import { ApiSuccess } from '../types/api.types';
import { CreateOrderPayload } from '../types/orders.types';

function ok<T>(res: Response, data: T, message?: string, status = 200): void {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(body);
}

const createOrderSchema = z.object({
  requestId: z.string().trim().min(1).optional(),
  customerSourceId: z.string().trim().min(1).optional(),
  clientName: z.string().trim().min(1),
  address: z.string().trim().min(1),
  deliveryRegion: z.string().trim().min(1).default('Metro Manila'),
  paymentTerms: z.string().trim().min(1).default('COD'),
  discount: z.number().finite().nonnegative().optional(),
  orderDiscount: z.number().finite().nonnegative().optional(),
  groupDiscounts: z.array(z.any()).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        warehouseId: z.string().trim().min(1).default('wh-default'),
        sku: z.string().default(''),
        name: z.string().default('Unnamed Product'),
        quantity: z.number().finite().int().positive(),
        unitPrice: z.number().finite().nonnegative(),
        priceType: z.string().optional(),
        prices: z.record(z.string(), z.number().nullable()).optional(),
        variation: z.string().optional(),
        unit: z.string().optional(),
      })
    )
    .min(1),
  agentId: z.string().trim().optional(),
  preparedBy: z.string().trim().optional(),
});

export async function createOrder(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid order payload.');
    }
    const payload = parsed.data as CreateOrderPayload;
    const result = await ordersService.createOrder(payload);
    ok(res, result, `Order "${result.order.orderNumber}" created successfully.`, 201);
  } catch (err) {
    next(err);
  }
}

export async function listOrders(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsedQuery = z
      .object({
        status: z.string().trim().min(1).optional(),
        clientName: z.string().trim().min(1).optional(),
        deliveryRegion: z.string().trim().min(1).optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      })
      .safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid order list query parameters.');
    }
    const result = await ordersService.listOrders(parsedQuery.data);
    ok(res, result, `${result.total} order(s) found.`);
  } catch (err) {
    next(err);
  }
}

export async function getOrderById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const order = await ordersService.getOrderById(id);
    ok(res, order);
  } catch (err) {
    next(err);
  }
}

const cancelOrderSchema = z.object({
  cancellationReason: z.string().trim().min(1).optional(),
  cancelledBy: z.string().trim().min(1).optional(),
});

export async function getCustomerTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const customerName = typeof req.params['customerName'] === 'string' ? req.params['customerName'].trim() : '';
    if (!customerName) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Customer name parameter is required.');
    }
    const transactions = await ordersService.getCustomerTransactions(customerName);
    ok(res, transactions, `Transactions for customer "${customerName}" retrieved.`);
  } catch (err) {
    next(err);
  }
}

export async function cancelOrder(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const parsed = cancelOrderSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid cancellation payload.');
    }
    const cancelled = await ordersService.cancelOrder(id, parsed.data);
    ok(res, cancelled, `Order "${cancelled.orderNumber}" cancelled and stock reserved rolled back to CMDB.`);
  } catch (err) {
    next(err);
  }
}

