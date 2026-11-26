/**
 * @file returns.controller.ts
 * @description Express controller handlers for Returns & Exchange Processing (FR-17).
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import * as returnsService from '../services/returns.service';
import { ApiSuccess } from '../types/api.types';
import { ProcessReturnPayload } from '../types/returns.types';

function ok<T>(res: Response, data: T, message?: string, status = 200): void {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(body);
}

const processReturnSchema = z.object({
  orderId: z.string().trim().min(1),
  clientId: z.string().trim().min(1).optional(),
  actionType: z.enum(['refund', 'exchange', 'credit']),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        sku: z.string().trim().min(1),
        name: z.string().default('Returned Product'),
        quantity: z.number().finite().positive(),
        condition: z.enum(['viable', 'damaged']),
        warehouseId: z.string().trim().min(1).default('wh-default'),
        unitPrice: z.number().finite().nonnegative(),
        refundAmount: z.number().finite().nonnegative().optional(),
      })
    )
    .min(1),
  refundMethod: z.enum(['Cash', 'Cheque', 'Debt_Adjustment']),
  reason: z.string().trim().default('Customer return'),
  processedBy: z.string().trim().min(1).default('Staff'),
  notes: z.string().optional(),
});

export async function processReturn(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = processReturnSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid return processing payload.');
    }
    const payload = parsed.data as ProcessReturnPayload;
    const result = await returnsService.processReturn(payload);
    ok(
      res,
      result,
      `Return "${result.returnNumber}" processed successfully: ${result.restockedItemsCount} viable CI(s) restocked, ${result.quarantinedItemsCount} damaged CI(s) quarantined.`,
      201
    );
  } catch (err) {
    next(err);
  }
}

export async function listReturns(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsedQuery = z
      .object({
        orderId: z.string().trim().min(1).optional(),
        clientId: z.string().trim().min(1).optional(),
        actionType: z.enum(['refund', 'exchange', 'credit', 'all']).optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      })
      .safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid returns query parameters.');
    }
    const result = await returnsService.listReturns(parsedQuery.data);
    ok(res, result, `${result.total} return record(s) found.`);
  } catch (err) {
    next(err);
  }
}

export async function getReturnById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const record = await returnsService.getReturnById(id);
    ok(res, record);
  } catch (err) {
    next(err);
  }
}

export async function getReturnAuditTrail(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const logs = returnsService.getReturnAuditTrail();
    ok(res, logs, `${logs.length} return audit trail entry(ies) retrieved.`);
  } catch (err) {
    next(err);
  }
}
