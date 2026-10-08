/**
 * @file pnl.routes.ts
 * @description Express router for Real-Time Profit & Loss (P&L) telemetry endpoints.
 *
 * Routes:
 *   GET   /today          - Get today's pulse (Target 1: Overview "Revenue today" card)
 *   GET   /summary        - Get aggregated P&L metrics (Revenue, COGS, Gross Profit, OPEX, Net Income)
 *   GET   /trend          - Get daily buckets (Target 3: Analytics graph under Revenue and order trend)
 *   GET   /performance    - Get monthly breakdown (Target 2: Financials Performance Bar Graph)
 *   POST  /expenses       - Record an operational expense or COGS adjustment
 *   GET   /expenses       - List expenses
 */

import { Router } from 'express';
import * as pnlCtrl from '../controllers/pnl.controller';

const router = Router();

router.get('/today', pnlCtrl.getTodayPulse);
router.get('/summary', pnlCtrl.getPnLSummary);
router.get('/trend', pnlCtrl.getPnLTrend);
router.get('/performance', pnlCtrl.getPerformanceBreakdown);
router.post('/expenses', pnlCtrl.recordExpense);
router.get('/expenses', pnlCtrl.listExpenses);

export default router;
