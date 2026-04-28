export type OrderQueueView = 'active' | 'done' | 'cancelled';

export interface QueueableOrder {
  id: string;
  status: string;
}

export const DONE_ORDER_STATUSES = new Set(['delivered', 'completed']);
export const CANCELLED_ORDER_STATUSES = new Set(['cancelled']);
export const TERMINAL_ORDER_STATUSES = new Set([
  ...DONE_ORDER_STATUSES,
  ...CANCELLED_ORDER_STATUSES,
]);

export const ORDER_QUEUE_VIEWS: Array<{
  id: OrderQueueView;
  label: string;
  helper: string;
}> = [
  { id: 'active', label: 'Active', helper: 'Incoming & kitchen queue' },
  { id: 'done', label: 'Done', helper: 'Delivered or completed' },
  { id: 'cancelled', label: 'Cancelled', helper: 'Revoked or removed' },
];

export function resolveOrderQueue(status: string): OrderQueueView {
  if (CANCELLED_ORDER_STATUSES.has(status)) return 'cancelled';
  if (DONE_ORDER_STATUSES.has(status)) return 'done';
  return 'active';
}

export function filterOrdersByQueue<T extends QueueableOrder>(
  orders: T[],
  queue: OrderQueueView,
  hiddenOrderIds: string[],
): T[] {
  const hidden = new Set(hiddenOrderIds);
  return orders.filter((order) => !hidden.has(order.id) && resolveOrderQueue(order.status) === queue);
}

export function getOrderQueueSummary(
  orders: QueueableOrder[],
  hiddenOrderIds: string[],
): Record<OrderQueueView, number> {
  return {
    active: filterOrdersByQueue(orders, 'active', hiddenOrderIds).length,
    done: filterOrdersByQueue(orders, 'done', hiddenOrderIds).length,
    cancelled: filterOrdersByQueue(orders, 'cancelled', hiddenOrderIds).length,
  };
}
