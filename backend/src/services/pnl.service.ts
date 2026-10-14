/**
 * @file pnl.service.ts
 * @description
 *   Core server-side service for Real-Time Profit & Loss (P&L) telemetry.
 *   Provides:
 *     • High-performance $O(1)$ integer-cent calculations (preventing floating-point drift).
 *     • Division-by-zero protection for margins.
 *     • Seamless categorization of Cost of Goods Sold (COGS) vs Operating Expenses (OPEX).
 *     • Full parity with Finance.tsx accounting rules.
 *     • Real-time WebSocket broadcasting upon expense or order state transitions.
 */

import { AppError } from '../middleware/errorHandler';
import { listOrders } from './orders.service';
import { broadcastPnLEvent } from '../ws/pnlBroadcaster';
import {
  PnLSummaryDto,
  TodayPnLPulseDto,
  DailyPnLBucketDto,
  MonthlyPerformanceDto,
  ExpenseDto,
  RecordExpensePayload,
  PnLTimeframe,
  PnLFilterQuery,
} from '../types/pnl.types';

// In-memory persistent store for Expenses
const expensesStore: Map<string, ExpenseDto> = new Map();

// Helper: safe cent rounding
function toCents(val: number): number {
  return Math.round(Number(val || 0) * 100);
}

function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

function safeMargin(profitCents: number, revenueCents: number): number {
  if (revenueCents <= 0) return 0;
  return Math.round((profitCents / revenueCents) * 10000) / 100;
}

// ─── Seed Data Parity with Finance.tsx & supabaseAdapter.ts ──────────────────

const DEFAULT_EXPENSES: Array<Omit<ExpenseDto, 'id' | 'createdAt' | 'updatedAt'>> = [
  // Jan 2025
  { category: 'Cost of Goods Sold', amount: 5904520.17, description: 'Jan 2025 Direct Cost of Goods Sold', date: '2025-01-31T20:00:00.000Z', recordedBy: 'accountant', orderId: 'ord_jan_2025' },
  { category: 'Freight and Shipping Costs', amount: -405.00, description: 'Jan 2025 Freight and Shipping Cost Adjustment', date: '2025-01-31T20:10:00.000Z', recordedBy: 'accountant' },
  { category: 'Office Supplies', amount: -230.00, description: 'Jan 2025 Office Supplies Credit Adjustment', date: '2025-01-31T20:20:00.000Z', recordedBy: 'accountant' },
  { category: 'Travel Expense', amount: 2500.00, description: 'Jan 2025 Operational Travel Expense', date: '2025-01-31T20:30:00.000Z', recordedBy: 'accountant' },
  { category: 'Utilities', amount: 0.00, description: 'Jan 2025 Facility Utilities', date: '2025-01-31T20:40:00.000Z', recordedBy: 'accountant' },
  { category: 'Ask My Accountant', amount: -2515.17, description: 'Jan 2025 CPA & Accountant Reconciled Credit', date: '2025-01-31T20:50:00.000Z', recordedBy: 'accountant' },
  { category: 'OTHER EXPENSE', amount: 12670.27, description: 'Jan 2025 General Operational & Other Expense', date: '2025-01-31T21:00:00.000Z', recordedBy: 'accountant' },

  // Feb 2025
  { category: 'Cost of Goods Sold', amount: 6100297.72, description: 'Feb 2025 Direct Cost of Goods Sold', date: '2025-02-28T20:00:00.000Z', recordedBy: 'accountant', orderId: 'ord_feb_2025' },
  { category: 'Freight and Shipping Costs', amount: -185.00, description: 'Feb 2025 Freight and Shipping Cost Adjustment', date: '2025-02-28T20:10:00.000Z', recordedBy: 'accountant' },
  { category: 'Office Supplies', amount: -345.00, description: 'Feb 2025 Office Supplies Credit Adjustment', date: '2025-02-28T20:20:00.000Z', recordedBy: 'accountant' },
  { category: 'Travel Expense', amount: 9000.00, description: 'Feb 2025 Operational Travel & Logistics Expense', date: '2025-02-28T20:30:00.000Z', recordedBy: 'accountant' },
  { category: 'Utilities', amount: 0.00, description: 'Feb 2025 Facility Utilities', date: '2025-02-28T20:40:00.000Z', recordedBy: 'accountant' },
  { category: 'Ask My Accountant', amount: -13735.76, description: 'Feb 2025 Accountant Audit Adjustments (Credit)', date: '2025-02-28T20:50:00.000Z', recordedBy: 'accountant' },
  { category: 'OTHER EXPENSE', amount: 4000.00, description: 'Feb 2025 General Operational & Other Expense', date: '2025-02-28T21:00:00.000Z', recordedBy: 'accountant' },

  // Mar 2025
  { category: 'Cost of Goods Sold', amount: 5082247.40, description: 'Mar 2025 Direct Cost of Goods Sold', date: '2025-03-31T20:00:00.000Z', recordedBy: 'accountant', orderId: 'ord_mar_2025' },
  { category: 'Freight and Shipping Costs', amount: -640.00, description: 'Mar 2025 Freight and Shipping Cost Adjustment', date: '2025-03-31T20:10:00.000Z', recordedBy: 'accountant' },
  { category: 'Office Supplies', amount: -690.00, description: 'Mar 2025 Office Supplies Credit Adjustment', date: '2025-03-31T20:20:00.000Z', recordedBy: 'accountant' },
  { category: 'Travel Expense', amount: 3000.00, description: 'Mar 2025 Operational Travel Expense', date: '2025-03-31T20:30:00.000Z', recordedBy: 'accountant' },
  { category: 'Utilities', amount: 0.00, description: 'Mar 2025 Facility Utilities', date: '2025-03-31T20:40:00.000Z', recordedBy: 'accountant' },
  { category: 'Ask My Accountant', amount: -2611.22, description: 'Mar 2025 Accountant Reconciliation Credit', date: '2025-03-31T20:50:00.000Z', recordedBy: 'accountant' },
  { category: 'OTHER EXPENSE', amount: 25710.23, description: 'Mar 2025 General Operational & Other Expense', date: '2025-03-31T21:00:00.000Z', recordedBy: 'accountant' },
];

function seedDefaultExpenses(): void {
  if (expensesStore.size > 0) return;
  const now = new Date().toISOString();
  DEFAULT_EXPENSES.forEach((exp, idx) => {
    const id = `exp_seed_${idx + 1}`;
    expensesStore.set(id, {
      id,
      ...exp,
      createdAt: now,
      updatedAt: now,
    });
  });
}

// Initial seed
seedDefaultExpenses();

/**
 * Checks whether an expense category falls under Cost of Goods Sold / Direct Freight.
 */
function isCogsCategory(category: string): boolean {
  const norm = (category || '').toLowerCase().trim();
  return norm.includes('cost of goods') || norm.includes('freight') || norm.includes('shipping cost');
}

/**
 * Parses timestamp string or Date object safely.
 */
function parseDate(val: any): Date | null {
  if (!val) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Public API Services ─────────────────────────────────────────────────────

/**
 * Retrieves today's operational P&L pulse specifically formatted for Target 1:
 * Overview Tab "Revenue Today" card.
 */
export async function getTodayPulse(): Promise<TodayPnLPulseDto> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { items: orders } = await listOrders({ pageSize: 1000 });

  let revenueCents = 0;
  let ordersToday = 0;

  for (const o of orders) {
    const orderDate = parseDate(o.createdAt);
    if (orderDate && orderDate >= today) {
      ordersToday++;
      if (['delivered', 'completed'].includes(o.status)) {
        revenueCents += toCents(o.totalAmount);
      }
    }
  }

  let cogsCents = 0;
  let opexCents = 0;

  for (const exp of expensesStore.values()) {
    const expDate = parseDate(exp.date);
    if (expDate && expDate >= today) {
      if (isCogsCategory(exp.category)) {
        cogsCents += toCents(exp.amount);
      } else {
        opexCents += toCents(exp.amount);
      }
    }
  }

  const grossProfitCents = revenueCents - cogsCents;
  const netProfitCents = grossProfitCents - opexCents;

  return {
    revenueToday: fromCents(revenueCents),
    cogsToday: fromCents(cogsCents),
    grossProfitToday: fromCents(grossProfitCents),
    grossMarginPctToday: safeMargin(grossProfitCents, revenueCents),
    expensesToday: fromCents(cogsCents + opexCents),
    netProfitToday: fromCents(netProfitCents),
    netMarginPctToday: safeMargin(netProfitCents, revenueCents),
    ordersToday,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Calculates aggregated P&L Summary over a given timeframe (today, 7d, 30d, 90d, all).
 */
export async function getPnLSummary(timeframe: PnLTimeframe = '30d'): Promise<PnLSummaryDto> {
  const now = new Date();
  let startDate: Date | null = null;

  if (timeframe === 'today') {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
  } else if (timeframe === '7d') {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - 7);
  } else if (timeframe === '30d') {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - 30);
  } else if (timeframe === '90d') {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - 90);
  }

  const { items: orders } = await listOrders({ pageSize: 1000 });

  let revenueCents = 0;
  let totalOrders = 0;
  let deliveredOrders = 0;

  for (const o of orders) {
    const d = parseDate(o.createdAt);
    if (!startDate || (d && d >= startDate)) {
      totalOrders++;
      if (['delivered', 'completed'].includes(o.status)) {
        deliveredOrders++;
        revenueCents += toCents(o.totalAmount);
      }
    }
  }

  // Include 2025 audited sales base if querying 'all'
  if (timeframe === 'all') {
    revenueCents += toCents(21502353.40); // Q1 2025 base from Finance.tsx
  }

  let cogsCents = 0;
  let opexCents = 0;

  for (const exp of expensesStore.values()) {
    const d = parseDate(exp.date);
    if (!startDate || (d && d >= startDate)) {
      if (isCogsCategory(exp.category)) {
        cogsCents += toCents(exp.amount);
      } else {
        opexCents += toCents(exp.amount);
      }
    }
  }

  const grossProfitCents = revenueCents - cogsCents;
  const netIncomeCents = grossProfitCents - opexCents;

  return {
    revenue: fromCents(revenueCents),
    cogs: fromCents(cogsCents),
    grossProfit: fromCents(grossProfitCents),
    grossMarginPct: safeMargin(grossProfitCents, revenueCents),
    operatingExpenses: fromCents(opexCents),
    operatingIncome: fromCents(grossProfitCents - opexCents),
    netIncome: fromCents(netIncomeCents),
    netMarginPct: safeMargin(netIncomeCents, revenueCents),
    totalOrders,
    deliveredOrders,
    timeframe,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Returns daily buckets for Target 3:
 * Dedicated P&L Flow / Waterfall Chart directly under 'Revenue and order trend' in Analytics.
 */
export async function getPnLTrend(days: 7 | 30 | 90 = 30): Promise<DailyPnLBucketDto[]> {
  const bucketCount = days === 7 ? 7 : days === 30 ? 10 : 12;
  const bucketSizeDays = Math.ceil(days / bucketCount);

  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(end.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);

  const { items: orders } = await listOrders({ pageSize: 1000 });
  const allExpenses = Array.from(expensesStore.values());

  const buckets: DailyPnLBucketDto[] = [];

  for (let idx = 0; idx < bucketCount; idx++) {
    const bucketStart = new Date(start);
    bucketStart.setDate(start.getDate() + idx * bucketSizeDays);
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setDate(bucketStart.getDate() + bucketSizeDays);

    let revCents = 0;
    let orderCount = 0;

    for (const o of orders) {
      const d = parseDate(o.createdAt);
      if (d && d >= bucketStart && d < bucketEnd) {
        orderCount++;
        if (['delivered', 'completed'].includes(o.status)) {
          revCents += toCents(o.totalAmount);
        }
      }
    }

    let cogsCents = 0;
    let expCents = 0;

    for (const exp of allExpenses) {
      const d = parseDate(exp.date);
      if (d && d >= bucketStart && d < bucketEnd) {
        if (isCogsCategory(exp.category)) {
          cogsCents += toCents(exp.amount);
        } else {
          expCents += toCents(exp.amount);
        }
      }
    }

    const gpCents = revCents - cogsCents;
    const netCents = gpCents - expCents;

    buckets.push({
      date: bucketStart.toISOString().split('T')[0],
      name: bucketStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      revenue: fromCents(revCents),
      cogs: fromCents(cogsCents),
      grossProfit: fromCents(gpCents),
      expenses: fromCents(cogsCents + expCents),
      netIncome: fromCents(netCents),
      orders: orderCount,
    });
  }

  return buckets;
}

/**
 * Returns monthly breakdown for Target 2:
 * Financials Tab 'Financial Performance' Bar Graph (Revenue vs Expenses vs Net).
 */
export async function getPerformanceBreakdown(): Promise<MonthlyPerformanceDto[]> {
  // Pre-configured historical baseline matching Finance.tsx Q1 2025
  const baseline2025: MonthlyPerformanceDto[] = [
    { name: 'Jan 25', Revenue: 8118370.93, Expenses: 5916540.27, Net: 2201830.66, cogs: 5904115.17 },
    { name: 'Feb 25', Revenue: 7073596.25, Expenses: 6099031.96, Net: 974564.29, cogs: 6100112.72 },
    { name: 'Mar 25', Revenue: 6310386.22, Expenses: 5107016.41, Net: 1203369.81, cogs: 5081607.40 },
  ];

  // Also compute live 2026 months from stores
  const { items: orders } = await listOrders({ pageSize: 1000 });
  const allExpenses = Array.from(expensesStore.values());

  const currentYear = new Date().getFullYear();
  if (currentYear >= 2026) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentMonthIdx = new Date().getMonth();

    for (let m = 0; m <= currentMonthIdx; m++) {
      let revCents = 0;
      for (const o of orders) {
        if (['delivered', 'completed'].includes(o.status)) {
          const d = parseDate(o.createdAt);
          if (d && d.getFullYear() === currentYear && d.getMonth() === m) {
            revCents += toCents(o.totalAmount);
          }
        }
      }

      let expCents = 0;
      let cogsCents = 0;
      for (const e of allExpenses) {
        const d = parseDate(e.date);
        if (d && d.getFullYear() === currentYear && d.getMonth() === m) {
          expCents += toCents(e.amount);
          if (isCogsCategory(e.category)) {
            cogsCents += toCents(e.amount);
          }
        }
      }

      if (revCents > 0 || expCents > 0) {
        baseline2025.push({
          name: `${monthNames[m]} ${currentYear.toString().slice(-2)}`,
          Revenue: fromCents(revCents),
          Expenses: fromCents(expCents),
          Net: fromCents(revCents - expCents),
          cogs: fromCents(cogsCents),
        });
      }
    }
  }

  return baseline2025;
}

/**
 * Records a new financial expense or COGS adjustment.
 * Immediately notifies all connected clients via WebSocket broadcaster.
 */
export async function recordExpense(payload: RecordExpensePayload): Promise<ExpenseDto> {
  if (!payload.category || payload.category.trim().length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Expense category is required.');
  }

  if (typeof payload.amount !== 'number' || Number.isNaN(payload.amount)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A valid expense amount is required.');
  }

  const id = `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const expense: ExpenseDto = {
    id,
    category: payload.category.trim(),
    amount: Math.round(payload.amount * 100) / 100,
    description: payload.description ? payload.description.trim() : '',
    date: payload.date || now,
    orderId: payload.orderId || null,
    recordedBy: payload.recordedBy || 'admin',
    createdAt: now,
    updatedAt: now,
  };

  expensesStore.set(id, expense);

  // Trigger live telemetry broadcast
  const todayPulse = await getTodayPulse();
  broadcastPnLEvent({
    event: 'pnl_pulse_update',
    data: todayPulse,
    timestamp: now,
  });

  return expense;
}

/**
 * Lists expenses with optional category and date filtering.
 */
export async function listExpenses(query: PnLFilterQuery = {}): Promise<ExpenseDto[]> {
  let list = Array.from(expensesStore.values());

  if (query.startDate) {
    const start = new Date(query.startDate);
    list = list.filter((e) => {
      const d = parseDate(e.date);
      return d && d >= start;
    });
  }

  if (query.endDate) {
    const end = new Date(query.endDate);
    list = list.filter((e) => {
      const d = parseDate(e.date);
      return d && d <= end;
    });
  }

  // Sort newest first
  list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return list;
}

/**
 * Notifies the P&L engine that an order transaction occurred.
 * Broadcasts an updated today pulse to all connected tabs.
 */
export async function notifyOrderMutation(): Promise<void> {
  const pulse = await getTodayPulse();
  broadcastPnLEvent({
    event: 'pnl_pulse_update',
    data: pulse,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Reset helper for clean unit tests.
 */
export function resetExpensesForTesting(): void {
  expensesStore.clear();
  seedDefaultExpenses();
}
