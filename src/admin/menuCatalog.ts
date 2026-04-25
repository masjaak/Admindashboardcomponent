export interface SyncedMenuItem {
  id: string;
  sourceItemId: string;
  name: string;
  category: string;
  description: string;
  image: string;
  price: number;
  isAvailable: boolean;
  unavailableReason?: string;
}

export interface MenuOverrideRecord {
  sourceItemId: string;
  name?: string;
  category?: string;
  description?: string;
  image?: string;
  price?: number;
  isAvailable?: boolean;
  unavailableReason?: string;
  isArchived?: boolean;
}

export function applyMenuOverrides(
  baseMenu: SyncedMenuItem[],
  overrides: MenuOverrideRecord[],
): SyncedMenuItem[] {
  const overridesBySource = new Map(overrides.map((item) => [item.sourceItemId, item]));

  return baseMenu
    .map((item) => {
      const override = overridesBySource.get(item.sourceItemId);
      if (!override) {
        return item;
      }

      return {
        ...item,
        ...override,
      };
    })
    .filter((item) => !(item as SyncedMenuItem & { isArchived?: boolean }).isArchived);
    }
