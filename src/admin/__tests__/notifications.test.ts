import { describe, expect, it } from 'vitest';
import { getNewIncomingOrderIds } from '../notifications';

describe('getNewIncomingOrderIds', () => {
  it('returns unread incoming order ids that were not in the previous snapshot', () => {
    const previous = [
      { id: 'order-1', status: 'incoming', isRead: false },
      { id: 'order-2', status: 'kitchen', isRead: true },
    ];
    const next = [
      ...previous,
      { id: 'order-3', status: 'incoming', isRead: false },
      { id: 'order-4', status: 'completed', isRead: false },
      { id: 'order-5', status: 'incoming', isRead: true },
    ];

    expect(getNewIncomingOrderIds(previous, next)).toEqual(['order-3']);
  });
});
