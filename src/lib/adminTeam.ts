import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export interface CreateAdminUserInput {
  email: string;
  password: string;
  name: string;
  username: string;
  role: 'manager' | 'staff';
  hotelId: string;
  active: boolean;
}

export interface UpdateAdminPasswordInput {
  uid: string;
  newPassword: string;
}

export interface UpdateAdminProfileInput {
  uid: string;
  name: string;
  username: string;
  role: 'manager' | 'staff';
  active: boolean;
}

const createAdminUserCallable = httpsCallable(functions, 'createAdminUser');
const updateAdminPasswordCallable = httpsCallable(functions, 'updateAdminPassword');
const updateAdminProfileCallable = httpsCallable(functions, 'updateAdminProfile');
const deleteAdminUserCallable = httpsCallable(functions, 'deleteAdminUser');

export async function createAdminUser(input: CreateAdminUserInput): Promise<void> {
  await createAdminUserCallable(input);
}

export async function updateAdminPassword(input: UpdateAdminPasswordInput): Promise<void> {
  await updateAdminPasswordCallable(input);
}

export async function updateAdminProfile(input: UpdateAdminProfileInput): Promise<void> {
  await updateAdminProfileCallable(input);
}

export async function deleteAdminUser(uid: string): Promise<void> {
  await deleteAdminUserCallable({ uid });
}
