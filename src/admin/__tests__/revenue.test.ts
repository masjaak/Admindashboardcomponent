import { describe, expect, it } from 'vitest';
import { buildRevenueExport, summarizeRevenue } from '../revenue';

const selectedDate = new Date('2026-04-26T10:00:00.000Z');

const orders = [
  {
    id: 'order-1',
    roomNumber: '1201',
    total: 250000,
    status: 'completed',
    paymentMethod: 'room',
    createdAt: new Date('2026-04-26T05:00:00.000Z'),
    guestUid: 'guest-1',
  },
  {
    id: 'order-2',
    roomNumber: '1202',
    total: 175000,
    status: 'delivered',
    paymentMethod: 'qris',
    createdAt: new Date('2026-04-26T08:30:00.000Z'),
    accessTokenId: 'token-2',
  },
  {
    id: 'order-3',
    roomNumber: '1203',
    total: 99000,
    status: 'cancelled',
    paymentMethod: 'bank',
    createdAt: new Date('2026-04-26T09:00:00.000Z'),
    guestUid: 'guest-3',
  },
  {
    id: 'legacy-order',
    roomNumber: '9999',
    total: 450000,
    status: 'completed',
    paymentMethod: 'room',
    createdAt: new Date('2026-04-26T06:15:00.000Z'),
  },
];

describe('summarizeRevenue', () => {
  it('builds daily revenue totals from completed and delivered orders', () => {
    const result = summarizeRevenue(orders, selectedDate);

    expect(result.kpi.revenue).toBe(425000);
    expect(result.kpi.completedOrders).toBe(2);
    expect(result.kpi.cancelledOrders).toBe(1);
    expect(result.rows).toHaveLength(2);
  });

  it('ignores legacy orders that are not tied to an active guest session', () => {
    const result = summarizeRevenue(orders, selectedDate);

    expect(result.rows.some((row) => row.id === 'legacy-order')).toBe(false);
    expect(result.kpi.revenue).toBe(425000);
  });
});

describe('buildRevenueExport', () => {
  it('returns an Excel-compatible export payload', () => {
    const summary = summarizeRevenue(orders, selectedDate);
    const result = buildRevenueExport(summary.rows, selectedDate);

    expect(result.filename).toBe('revenue-2026-04-26.xls');
    expect(result.mimeType).toBe('application/vnd.ms-excel');
    expect(result.content).toContain('Room 1201');
    expect(result.content).toContain('425000');
  });
});
