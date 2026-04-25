import { describe, expect, it } from 'vitest';
import { applyMenuOverrides } from '../menuCatalog';

const baseMenu = [
  {
    id: 'item-1',
    sourceItemId: 'guest-1',
    name: 'Beef Cheek Rendang',
    category: 'Signatures',
    description: 'Slow-braised beef cheek.',
    image: '/menu/rendang.jpg',
    price: 245000,
    isAvailable: true,
  },
  {
    id: 'item-2',
    sourceItemId: 'guest-2',
    name: 'Fresh Orange Juice',
    category: 'Beverages',
    description: 'Cold pressed.',
    image: '/menu/juice.jpg',
    price: 65000,
    isAvailable: true,
  },
];

describe('applyMenuOverrides', () => {
  it('merges dashboard overrides into the synced guest catalog', () => {
    const result = applyMenuOverrides(baseMenu, [
      {
        sourceItemId: 'guest-1',
        name: 'Beef Cheek Rendang Deluxe',
        price: 255000,
        isAvailable: false,
        unavailableReason: 'Sold out for dinner service',
      },
    ]);

    expect(result[0]).toMatchObject({
      sourceItemId: 'guest-1',
      name: 'Beef Cheek Rendang Deluxe',
      price: 255000,
      isAvailable: false,
      unavailableReason: 'Sold out for dinner service',
    });
  });

  it('removes archived items from the guest-facing menu sync', () => {
    const result = applyMenuOverrides(baseMenu, [
      {
        sourceItemId: 'guest-2',
        isArchived: true,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].sourceItemId).toBe('guest-1');
  });
});
