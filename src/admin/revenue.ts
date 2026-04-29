interface RevenueOrder {
  id: string;
  roomNumber: string;
  total: number;
  status: string;
  paymentMethod: string;
  createdAt: Date | null;
  guestUid?: string;
  accessTokenId?: string;
  source?: string;
}

export interface RevenueRow {
  id: string;
  roomNumber: string;
  paymentMethod: string;
  total: number;
  createdAt: Date;
}

export interface RevenueSummary {
  kpi: {
    revenue: number;
    completedOrders: number;
    cancelledOrders: number;
  };
  rows: RevenueRow[];
}

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
  );
}

function formatDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isOperationalRevenueOrder(order: RevenueOrder): boolean {
  return Boolean(
    (typeof order.guestUid === 'string' && order.guestUid.trim())
    || (typeof order.accessTokenId === 'string' && order.accessTokenId.trim())
    || order.source === 'spark_demo',
  );
}

export function summarizeRevenue(orders: RevenueOrder[], selectedDate: Date): RevenueSummary {
  const rows = orders
    .filter(isOperationalRevenueOrder)
    .filter((order) => order.createdAt instanceof Date && isSameDay(order.createdAt, selectedDate))
    .filter((order) => order.status === 'completed' || order.status === 'delivered')
    .map((order) => ({
      id: order.id,
      roomNumber: order.roomNumber,
      paymentMethod: order.paymentMethod,
      total: order.total,
      createdAt: order.createdAt as Date,
    }));

  const cancelledOrders = orders.filter(
    (order) => isOperationalRevenueOrder(order)
      && order.createdAt instanceof Date
      && isSameDay(order.createdAt, selectedDate)
      && order.status === 'cancelled',
  ).length;

  const revenue = rows.reduce((sum, row) => sum + row.total, 0);

  return {
    kpi: {
      revenue,
      completedOrders: rows.length,
      cancelledOrders,
    },
    rows,
  };
}

export function buildRevenueExport(rows: RevenueRow[], selectedDate: Date): {
  filename: string;
  mimeType: string;
  content: string;
} {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const rowsMarkup = rows.map((row) => (
    `<tr><td>${row.id}</td><td>Room ${row.roomNumber}</td><td>${row.paymentMethod}</td><td>${row.total}</td><td>${row.createdAt.toISOString()}</td></tr>`
  )).join('');

  return {
    filename: `revenue-${formatDateStamp(selectedDate)}.xls`,
    mimeType: 'application/vnd.ms-excel',
    content: `
      <table>
        <tr><th>Order ID</th><th>Room</th><th>Payment</th><th>Total</th><th>Created At</th></tr>
        ${rowsMarkup}
        <tr><td colspan="3">Grand Total</td><td>${total}</td><td></td></tr>
      </table>
    `.trim(),
  };
}
