/**
 * @file pnl.controller.ts
 * @description
 *   Express controller handlers for the Real-Time P&L module.
 *   Provides clean, typed JSON responses for all 3 target UI locations:
 *     1. Overview Tab: /api/v1/pnl/today
 *     2. Financials Tab: /api/v1/pnl/performance
 *     3. Analytics Tab: /api/v1/pnl/trend & /api/v1/pnl/summary
 */

import { Request, Response, NextFunction } from 'express';
import * as pnlService from '../services/pnl.service';
import { ApiSuccess } from '../types/api.types';
import { PnLTimeframe, RecordExpensePayload } from '../types/pnl.types';

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
 * GET /api/v1/pnl/today
 * Returns today's pulse for Overview Tab (Revenue today & Net profit today).
 */
export async function getTodayPulse(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await pnlService.getTodayPulse();
    ok(res, data, "Today's P&L pulse fetched successfully.");
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/pnl/summary?timeframe=30d
 * Returns aggregated P&L Summary (Revenue, COGS, Gross Profit, OPEX, Net Income).
 */
export async function getPnLSummary(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const timeframe = (req.query['timeframe'] as PnLTimeframe) || '30d';
    const data = await pnlService.getPnLSummary(timeframe);
    ok(res, data, `P&L summary for period "${timeframe}" calculated.`);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/pnl/trend?days=30
 * Returns daily buckets for the Analytics chart under Revenue & Order Trend.
 */
export async function getPnLTrend(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawDays = req.query['days'] ? parseInt(req.query['days'] as string, 10) : 30;
    const days = rawDays === 7 ? 7 : rawDays === 90 ? 90 : 30;
    const data = await pnlService.getPnLTrend(days);
    ok(res, data, `P&L trend for ${days} days fetched.`);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/pnl/performance
 * Returns monthly breakdown for Financials Tab Performance Bar Graph.
 */
export async function getPerformanceBreakdown(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await pnlService.getPerformanceBreakdown();
    ok(res, data, 'Monthly financial performance breakdown fetched.');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/pnl/expenses
 * Records an expense or COGS adjustment and broadcasts telemetry.
 */
export async function recordExpense(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = req.body as RecordExpensePayload;
    const data = await pnlService.recordExpense(payload);
    ok(res, data, 'Expense recorded successfully.', 201);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/pnl/expenses
 * Lists expenses.
 */
export async function listExpenses(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await pnlService.listExpenses({
      startDate: req.query['startDate'] as string,
      endDate: req.query['endDate'] as string,
    });
    ok(res, data, `${data.length} expense record(s) found.`);
  } catch (err) {
    next(err);
  }
}
