export type AdminRole = 'manager' | 'staff';

export interface AdminProfileRecord {
  name: string;
  role: AdminRole;
  active: boolean;
}

interface ResolveAdminSessionInput {
  uid: string;
  email: string;
  profile: AdminProfileRecord | null;
}

type AdminSessionResult =
  | {
      status: 'authenticated';
      uid: string;
      email: string;
      name: string;
      role: AdminRole;
    }
  | {
      status: 'forbidden';
      reason: 'missing-profile' | 'inactive';
    };

export function resolveAdminSession(input: ResolveAdminSessionInput): AdminSessionResult {
  if (!input.profile) {
    return {
      status: 'forbidden',
      reason: 'missing-profile',
    };
  }

  if (!input.profile.active) {
    return {
      status: 'forbidden',
      reason: 'inactive',
    };
  }

  return {
    status: 'authenticated',
    uid: input.uid,
    email: input.email,
    name: input.profile.name,
    role: input.profile.role,
  };
}
