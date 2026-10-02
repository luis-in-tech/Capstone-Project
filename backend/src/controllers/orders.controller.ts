/**
 * @file orders.controller.ts
 * @description Express controller handlers for the Orders API.
 */

import { Request, Response, NextFunction } from 'express';
import * as ordersService from '../services/orders.service';
import { ApiSuccess } from '../types/api.types';
import { CreateOrderPayload, OrderFilterQuery } from '../types/orders.types';

function ok<T>(res: Response, data: T, message?: string, status = 200): void {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(body);
}

export async function createOrder(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = req.body as CreateOrderPayload;
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
    const query: OrderFilterQuery = {
      status: req.query['status'] as string,
      clientName: req.query['clientName'] as string,
      deliveryRegion: req.query['deliveryRegion'] as string,
      page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
      pageSize: req.query['pageSize'] ? parseInt(req.query['pageSize'] as string, 10) : undefined,
    };
    const result = await ordersService.listOrders(query);
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

export async function getCustomerTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const customerName = req.params['customerName'] as string;
    const transactions = await ordersService.getCustomerTransactions(customerName);
    ok(res, transactions, `Transactions for customer "${customerName}" retrieved.`);
  } catch (err) {
    next(err);
  }
}
