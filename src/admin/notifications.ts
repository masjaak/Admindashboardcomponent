interface NotificationOrder {
  id: string;
  status: string;
  isRead: boolean;
}

export function getNewIncomingOrderIds(
  previousOrders: NotificationOrder[],
  nextOrders: NotificationOrder[],
): string[] {
  const previousIds = new Set(previousOrders.map((order) => order.id));

  return nextOrders
    .filter((order) => !previousIds.has(order.id))
    .filter((order) => order.status === 'incoming' && order.isRead === false)
    .map((order) => order.id);
}
