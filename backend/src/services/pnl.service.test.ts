/**
 * @file pnl.service.test.ts
 * @description Unit tests for Real-Time P&L service.
 * Tests edge cases, stress math (negative credits, zero-division margins, rounding),
 * and parity across the 3 target locations.
 */

import * as pnlService from './pnl.service';
import * as ordersService from './orders.service';
import { broadcastPnLEvent, registerSubscriber, getSubscriberCount } from '../ws/pnlBroadcaster';
import { WebSocket } from 'ws';

describe('Real-Time P&L Service', () => {
  beforeEach(() => {
    pnlService.resetExpensesForTesting();
  });

  describe('Target 1: Overview Pulse (getTodayPulse)', () => {
    it('should return safe zero margins when there is zero revenue today', async () => {
      const pulse = await pnlService.getTodayPulse();

      expect(pulse).toBeDefined();
      expect(typeof pulse.revenueToday).toBe('number');
      expect(typeof pulse.grossMarginPctToday).toBe('number');
      expect(typeof pulse.netMarginPctToday).toBe('number');
      expect(pulse.grossMarginPctToday).toBe(0);
      expect(pulse.netMarginPctToday).toBe(0);
      expect(pulse.lastUpdated).toBeDefined();
    });

    it('should correctly calculate revenue and profit when a delivered order exists today', async () => {
      // Create an order via ordersService
      const { order } = await ordersService.createOrder({
        clientName: 'Alpha Logistics Tech',
        address: '123 Pasig City',
        deliveryRegion: 'Metro Manila',
        paymentTerms: 'COD',
        items: [
          {
            productId: 'prod-001',
            warehouseId: 'wh-1',
            sku: 'SKU-TEST-1',
            name: 'Test Helmet',
            quantity: 2,
            unitPrice: 1500,
          },
        ],
      });

      // Manually set status to delivered to test recognized revenue
      order.status = 'delivered';

      const pulse = await pnlService.getTodayPulse();
      expect(pulse.revenueToday).toBe(3000);
      expect(pulse.grossProfitToday).toBe(3000);
      expect(pulse.grossMarginPctToday).toBe(100);
      expect(pulse.netProfitToday).toBe(3000);
    });
  });

  describe('Target 2: Financials Performance Breakdown (getPerformanceBreakdown)', () => {
    it('should return Q1 2025 audited months matching Finance.tsx statement', async () => {
      const breakdown = await pnlService.getPerformanceBreakdown();

      expect(breakdown.length).toBeGreaterThanOrEqual(3);

      const jan = breakdown.find((b) => b.name === 'Jan 25');
      const feb = breakdown.find((b) => b.name === 'Feb 25');
      const mar = breakdown.find((b) => b.name === 'Mar 25');

      expect(jan).toBeDefined();
      expect(jan?.Revenue).toBeCloseTo(8118370.93, 1);
      expect(jan?.Net).toBeCloseTo(2201830.66, 1);

      expect(feb).toBeDefined();
      expect(feb?.Revenue).toBeCloseTo(7073596.25, 1);
      expect(feb?.Net).toBeCloseTo(974564.29, 1);

      expect(mar).toBeDefined();
      expect(mar?.Revenue).toBeCloseTo(6310386.22, 1);
      expect(mar?.Net).toBeCloseTo(1203369.81, 1);
    });
  });

  describe('Target 3: Analytics Trend Buckets (getPnLTrend)', () => {
    it('should generate 10 daily buckets for 30-day timeframe', async () => {
      const buckets = await pnlService.getPnLTrend(30);

      expect(buckets).toHaveLength(10);
      buckets.forEach((bucket) => {
        expect(bucket.date).toBeDefined();
        expect(bucket.name).toBeDefined();
        expect(typeof bucket.revenue).toBe('number');
        expect(typeof bucket.cogs).toBe('number');
        expect(typeof bucket.grossProfit).toBe('number');
        expect(typeof bucket.expenses).toBe('number');
        expect(typeof bucket.netIncome).toBe('number');
      });
    });

    it('should generate 7 daily buckets for 7-day timeframe', async () => {
      const buckets = await pnlService.getPnLTrend(7);
      expect(buckets).toHaveLength(7);
    });

    it('should generate 12 buckets for 90-day timeframe', async () => {
      const buckets = await pnlService.getPnLTrend(90);
      expect(buckets).toHaveLength(12);
    });
  });

  describe('Expense Recording & Category Segregation', () => {
    it('should reject invalid expense payloads', async () => {
      await expect(
        pnlService.recordExpense({
          category: '',
          amount: 500,
          description: 'Empty category',
        })
      ).rejects.toThrow('Expense category is required');

      await expect(
        pnlService.recordExpense({
          category: 'Office Supplies',
          amount: NaN,
          description: 'Bad amount',
        })
      ).rejects.toThrow('A valid expense amount is required');
    });

    it('should record operational expense and update summary', async () => {
      const expense = await pnlService.recordExpense({
        category: 'Office Supplies',
        amount: 450.50,
        description: 'Printer ink',
      });

      expect(expense.id).toBeDefined();
      expect(expense.amount).toBe(450.50);

      const list = await pnlService.listExpenses();
      expect(list.some((e) => e.id === expense.id)).toBe(true);
    });

    it('should handle negative credits and adjustments safely without math corruption', async () => {
      const credit = await pnlService.recordExpense({
        category: 'Freight and Shipping Costs',
        amount: -250.00,
        description: 'Freight rebate credit',
      });

      expect(credit.amount).toBe(-250.00);

      const pulse = await pnlService.getTodayPulse();
      expect(pulse.cogsToday).toBeLessThanOrEqual(0);
    });
  });

  describe('Aggregated Summary (getPnLSummary)', () => {
    it('should calculate Q1 2025 base totals when timeframe is all', async () => {
      const summary = await pnlService.getPnLSummary('all');

      expect(summary.revenue).toBeGreaterThan(20000000);
      expect(summary.cogs).toBeGreaterThan(15000000);
      expect(summary.grossProfit).toBeGreaterThan(0);
      expect(summary.grossMarginPct).toBeGreaterThan(0);
      expect(summary.netIncome).toBeGreaterThan(0);
    });
  });

  describe('WebSocket Broadcaster', () => {
    it('should register subscribers and handle broadcast gracefully', () => {
      const mockWs = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
        on: jest.fn(),
      } as unknown as WebSocket;

      const initialCount = getSubscriberCount();
      registerSubscriber(mockWs);
      expect(getSubscriberCount()).toBe(initialCount + 1);

      broadcastPnLEvent({
        event: 'pnl_pulse_update',
        data: { test: true },
        timestamp: new Date().toISOString(),
      });

      expect(mockWs.send).toHaveBeenCalled();
    });
  });
});
