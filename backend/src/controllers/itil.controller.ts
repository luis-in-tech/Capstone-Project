/**
 * @file itil.controller.ts
 * @description Controller handlers for ITIL SLA Incidents & Defective Quarantine (FR-06 & FR-11).
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import * as itilService from '../services/itil.service';
import { ApiSuccess } from '../types/api.types';
import { CreateQuarantineTicketPayload } from '../types/itil.types';

function ok<T>(res: Response, data: T, message?: string, status = 200): void {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(body);
}

/**
 * GET /api/v1/itil/sla-incidents
 * Evaluates orders against SLA and returns active breach incidents.
 */
export async function getSlaIncidents(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await itilService.evaluateSlaIncidents();
    ok(res, result, `${result.breachCount} SLA breach incident(s) detected.`);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/itil/quarantine
 * Logs an ITIL exception ticket for defective items.
 */
const createQuarantineSchema = z.object({
  sku: z.string().trim().min(1),
  productName: z.string().trim().min(1).default('Quarantined CI'),
  warehouseId: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  defectCategory: z
    .enum(['shipping_damage', 'manufacturing_defect', 'expired_shelf_life', 'packaging_torn'])
    .default('shipping_damage'),
  severity: z.enum(['minor', 'moderate', 'critical']).default('moderate'),
  reportedBy: z.string().trim().min(1).default('warehouse_staff'),
  notes: z.string().optional(),
});

export async function createQuarantineTicket(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = createQuarantineSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid quarantine ticket payload.');
    }
    const payload = parsed.data as CreateQuarantineTicketPayload;
    const ticket = await itilService.createQuarantineTicket(payload);
    ok(res, ticket, `Defective stock ticket "${ticket.ticketNumber}" logged and units quarantined.`, 201);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/itil/quarantine
 * Lists quarantined items.
 */
export async function listQuarantineTickets(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsedQuery = z
      .object({
        warehouseId: z.string().trim().min(1).optional(),
        defectCategory: z.string().trim().min(1).optional(),
        status: z.string().trim().min(1).optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      })
      .safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid quarantine query parameters.');
    }
    const result = await itilService.listQuarantineTickets(parsedQuery.data);
    ok(res, result, `${result.total} quarantined item ticket(s) found.`);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/itil/quarantine/supplier-report
 * Exports Defective Products Report for supplier returns to CSV.
 */
export async function exportSupplierReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawTicketIds = typeof req.query['ticketIds'] === 'string' ? req.query['ticketIds'] : '';
    const parsedTicketIds = rawTicketIds
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const ticketIds = parsedTicketIds.length > 0 ? parsedTicketIds : undefined;
    const csv = await itilService.exportSupplierReturnsCsv(ticketIds);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Supplier_Defective_Products_Report_${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
}
