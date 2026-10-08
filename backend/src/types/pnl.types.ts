/**
 * @file pnl.types.ts
 * @description
 *   Type definitions for the Real-Time Profit & Loss (P&L) Engine.
 *   Provides types for live summaries, daily time-series buckets, monthly performance bars,
 *   expense entries, and real-time streaming WebSocket events.
 */

export type PnLTimeframe = 'today' | '7d' | '30d' | '90d' | 'all';

export interface PnLSummaryDto {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  operatingExpenses: number;
  operatingIncome: number;
  netIncome: number;
  netMarginPct: number;
  totalOrders: number;
  deliveredOrders: number;
  timeframe: PnLTimeframe;
  lastUpdated: string;
}

export interface TodayPnLPulseDto {
  revenueToday: number;
  cogsToday: number;
  grossProfitToday: number;
  grossMarginPctToday: number;
  expensesToday: number;
  netProfitToday: number;
  netMarginPctToday: number;
  ordersToday: number;
  lastUpdated: string;
}

export interface DailyPnLBucketDto {
  date: string;
  name: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netIncome: number;
  orders: number;
}

export interface MonthlyPerformanceDto {
  name: string;
  Revenue: number;
  Expenses: number;
  Net: number;
  cogs?: number;
}

export interface ExpenseDto {
  id: string;
  category: string;
  amount: number;
  description: string;
  date: string;
  orderId?: string | null;
  recordedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecordExpensePayload {
  category: string;
  amount: number;
  description: string;
  date?: string;
  orderId?: string | null;
  recordedBy?: string;
}

export interface PnLFilterQuery {
  timeframe?: PnLTimeframe;
  region?: string;
  startDate?: string;
  endDate?: string;
}

export interface WsPnLEvent {
  event: 'pnl_pulse_update' | 'pnl_summary_update' | 'pnl_expense_recorded';
  data: TodayPnLPulseDto | PnLSummaryDto | ExpenseDto | any;
  timestamp: string;
}
