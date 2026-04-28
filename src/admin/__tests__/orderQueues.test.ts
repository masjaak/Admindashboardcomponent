import { describe, expect, it } from 'vitest';
import { filterOrdersByQueue, getOrderQueueSummary, ORDER_QUEUE_VIEWS } from '../orderQueues';

const orders = [
  { id: 'incoming-1', status: 'incoming', isRead: false },
  { id: 'preparing-1', status: 'preparing', isRead: true },
  { id: 'delivered-1', status: 'delivered', isRead: true },
  { id: 'completed-1', status: 'completed', isRead: true },
  { id: 'cancelled-1', status: 'cancelled', isRead: true },
];

describe('order queue state machine', () => {
  it('defines the three live-order queues used by the dashboard tabs', () => {
    expect(ORDER_QUEUE_VIEWS.map((view) => view.id)).toEqual(['active', 'done', 'cancelled']);
  });

  it('separates active, done, and cancelled orders without mixing terminal states', () => {
    expect(filterOrdersByQueue(orders, 'active', []).map((order) => order.id)).toEqual(['incoming-1', 'preparing-1']);
    expect(filterOrdersByQueue(orders, 'done', []).map((order) => order.id)).toEqual(['delivered-1', 'completed-1']);
    expect(filterOrdersByQueue(orders, 'cancelled', []).map((order) => order.id)).toEqual(['cancelled-1']);
  });

  it('honors locally hidden order ids for all queue states', () => {
    expect(filterOrdersByQueue(orders, 'done', ['completed-1']).map((order) => order.id)).toEqual(['delivered-1']);
    expect(filterOrdersByQueue(orders, 'cancelled', ['cancelled-1'])).toHaveLength(0);
  });

  it('returns queue counts for the segmented control badges', () => {
    expect(getOrderQueueSummary(orders, [])).toEqual({
      active: 2,
      done: 2,
      cancelled: 1,
    });
  });
});
