/**
 * @file transfers.controller.ts
 * @description Express controller handlers for the Transfers API.
 */

import { Request, Response, NextFunction } from 'express';
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

export async function initiateTransfers(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = req.body as InitiateTransferPayload;
    const created = await transfersService.initiateTransfers(payload);
    ok(res, created, `${created.length} transfer request(s) initiated successfully.`, 201);
  } catch (err) {
    next(err);
  }
}

export async function dispatchTransfer(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = req.params['id'] as string;
    const payload = req.body as DispatchTransferPayload;
    const updated = await transfersService.dispatchTransfer(id, payload);
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
    const id = req.params['id'] as string;
    const payload = req.body as ReceiveTransferPayload;
    const updated = await transfersService.receiveTransfer(id, payload);
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
    const id = req.params['id'] as string;
    const payload = req.body as CancelTransferPayload;
    const updated = await transfersService.cancelTransfer(id, payload);
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

export async function listTransfers(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query: TransferFilterQuery = {
      status: req.query['status'] as any,
      warehouseId: req.query['warehouseId'] as string,
      page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
      pageSize: req.query['pageSize'] ? parseInt(req.query['pageSize'] as string, 10) : undefined,
    };
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
    const transferId = req.query['transferId'] as string | undefined;
    const logs = await transfersService.getTransferAuditLogs(transferId);
    ok(res, logs, `${logs.length} audit log(s) retrieved.`);
  } catch (err) {
    next(err);
  }
}
