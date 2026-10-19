/**
 * @file itil.controller.ts
 * @description Controller handlers for ITIL SLA Incidents & Defective Quarantine (FR-06 & FR-11).
 */

import { Request, Response, NextFunction } from 'express';
import * as itilService from '../services/itil.service';
import { ApiSuccess } from '../types/api.types';
import { CreateQuarantineTicketPayload, QuarantineFilterQuery } from '../types/itil.types';

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
export async function createQuarantineTicket(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = req.body as CreateQuarantineTicketPayload;
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
    const query: QuarantineFilterQuery = {
      warehouseId: req.query['warehouseId'] as string,
      defectCategory: req.query['defectCategory'] as string,
      status: req.query['status'] as string,
      page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
      pageSize: req.query['pageSize'] ? parseInt(req.query['pageSize'] as string, 10) : undefined,
    };
    const result = await itilService.listQuarantineTickets(query);
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
    const ticketIds = req.query['ticketIds'] ? (req.query['ticketIds'] as string).split(',') : undefined;
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
