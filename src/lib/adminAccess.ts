import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export interface GuestQrTokenResponse {
  tokenId: string;
  qrUrl: string;
  rawToken: string;
  expiresAt: string;
}

interface CreateGuestQrTokenInput {
  hotelId: string;
  stayId: string;
  roomNumber: string;
  baseUrl: string;
  expiresInMinutes?: number;
}

const createGuestAccessTokenCallable = httpsCallable(functions, 'createGuestAccessToken');
const revokeGuestSessionCallable = httpsCallable(functions, 'revokeGuestSession');

export async function createGuestQrToken(input: CreateGuestQrTokenInput): Promise<GuestQrTokenResponse> {
  const result = await createGuestAccessTokenCallable(input);
  return result.data as GuestQrTokenResponse;
}

export async function revokeGuestSessionAsAdmin(guestUid: string): Promise<void> {
  await revokeGuestSessionCallable({ guestUid });
}
