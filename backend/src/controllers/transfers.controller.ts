/**
 * @file transfers.controller.ts
 * @description Express controller handlers for the Transfers API.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import * as transfersService from '../services/transfers.service';
import { ApiSuccess } from '../types/api.types';
import {
  InitiateTransferPayload,
  DispatchTransferPayload,
  ReceiveTransferPayload,
  CancelTransferPayload,
  TransferFilterQuery,
} from '../types/transfers.types';

function ok<T>(res: Response, data: T, message?: string, status = 200): void {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(body);
}

const initiateTransfersSchema = z.object({
  sourceWarehouseId: z.string().trim().min(1),
  destinationWarehouseId: z.string().trim().min(1),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
  initiatedBy: z.string().trim().min(1).default('system'),
  notes: z.string().optional(),
});

export async function initiateTransfers(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = initiateTransfersSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid transfer initiation payload.');
    }
    const payload = parsed.data as InitiateTransferPayload;
    const created = await transfersService.initiateTransfers(payload);
    ok(res, created, `${created.length} transfer request(s) initiated successfully.`, 201);
  } catch (err) {
    next(err);
  }
}

const dispatchTransferSchema = z.object({
  driverName: z.string().trim().optional(),
  vehiclePlate: z.string().trim().optional(),
  dispatchedBy: z.string().trim().min(1).default('system'),
});

const receiveTransferSchema = z.object({
  receivedBy: z.string().trim().min(1).default('system'),
  notes: z.string().optional(),
});

const cancelTransferSchema = z.object({
  cancellationReason: z.string().trim().min(1),
  cancelledBy: z.string().trim().min(1).default('system'),
});

export async function dispatchTransfer(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = typeof req.params['id'] === 'string' ? req.params['id'].trim() : '';
    if (!id) throw new AppError(400, 'VALIDATION_ERROR', 'Transfer ID is required.');
    const parsed = dispatchTransferSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid dispatch payload.');
    const updated = await transfersService.dispatchTransfer(id, parsed.data as DispatchTransferPayload);
    ok(res, updated, `Transfer "${id}" marked in_transit and deducted from origin facility.`);
  } catch (err) {
    next(err);
  }
}

export async function receiveTransfer(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = typeof req.params['id'] === 'string' ? req.params['id'].trim() : '';
    if (!id) throw new AppError(400, 'VALIDATION_ERROR', 'Transfer ID is required.');
    const parsed = receiveTransferSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid receive payload.');
    const updated = await transfersService.receiveTransfer(id, parsed.data as ReceiveTransferPayload);
    ok(res, updated, `Transfer "${id}" received and credited to destination facility.`);
  } catch (err) {
    next(err);
  }
}

export async function cancelTransfer(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = typeof req.params['id'] === 'string' ? req.params['id'].trim() : '';
    if (!id) throw new AppError(400, 'VALIDATION_ERROR', 'Transfer ID is required.');
    const parsed = cancelTransferSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'A cancellation reason is required.');
    const updated = await transfersService.cancelTransfer(id, parsed.data as CancelTransferPayload);
    ok(res, updated, `Transfer "${id}" cancelled successfully.`);
  } catch (err) {
    next(err);
  }
}

export async function getTransferById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const transfer = await transfersService.getTransferById(id);
    ok(res, transfer);
  } catch (err) {
    next(err);
  }
}

const listTransfersQuerySchema = z.object({
  status: z.enum(['pending', 'in_transit', 'received', 'cancelled', 'all']).optional(),
  warehouseId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export async function listTransfers(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = listTransfersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid transfer query parameters.');
    }
    const query: TransferFilterQuery = parsed.data;
    const result = await transfersService.listTransfers(query);
    ok(res, result, `${result.total} transfer(s) found.`);
  } catch (err) {
    next(err);
  }
}

export async function getAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawId = req.query['transferId'];
    if (rawId !== undefined && typeof rawId !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid transferId filter.');
    }
    const transferId = typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : undefined;
    const logs = await transfersService.getTransferAuditLogs(transferId);
    ok(res, logs, `${logs.length} audit log(s) retrieved.`);
  } catch (err) {
    next(err);
  }
}
