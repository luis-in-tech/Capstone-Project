/**
 * @file returns.controller.ts
 * @description Express controller handlers for Returns & Exchange Processing (FR-17).
 */

import { Request, Response, NextFunction } from 'express';
import * as returnsService from '../services/returns.service';
import { ApiSuccess } from '../types/api.types';
import { ProcessReturnPayload, ReturnFilterQuery } from '../types/returns.types';

function ok<T>(res: Response, data: T, message?: string, status = 200): void {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(body);
}

export async function processReturn(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = req.body as ProcessReturnPayload;
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
    const query: ReturnFilterQuery = {
      orderId: req.query['orderId'] as string,
      clientId: req.query['clientId'] as string,
      actionType: req.query['actionType'] as string,
      page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
      pageSize: req.query['pageSize'] ? parseInt(req.query['pageSize'] as string, 10) : undefined,
    };
    const result = await returnsService.listReturns(query);
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
