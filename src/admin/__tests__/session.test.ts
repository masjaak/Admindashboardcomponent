import { describe, expect, it } from 'vitest';
import { resolveAdminSession } from '../session';

describe('resolveAdminSession', () => {
  it('accepts active manager and staff records', () => {
    expect(
      resolveAdminSession({
        uid: 'manager-1',
        email: 'manager@hotel.test',
        profile: { name: 'Manager A', role: 'manager', active: true },
      }),
    ).toMatchObject({
      status: 'authenticated',
      role: 'manager',
    });

    expect(
      resolveAdminSession({
        uid: 'staff-1',
        email: 'staff@hotel.test',
        profile: { name: 'Staff A', role: 'staff', active: true },
      }),
    ).toMatchObject({
      status: 'authenticated',
      role: 'staff',
    });
  });

  it('rejects inactive admin records', () => {
    expect(
      resolveAdminSession({
        uid: 'staff-2',
        email: 'inactive@hotel.test',
        profile: { name: 'Inactive', role: 'staff', active: false },
      }),
    ).toMatchObject({
      status: 'forbidden',
      reason: 'inactive',
    });
  });
});
