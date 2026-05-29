import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { User, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { auth, db, firebaseConfig } from '../../lib/firebase';
import {
  createAdminUser,
  deleteAdminUser,
  updateAdminPassword,
  updateAdminProfile,
} from '../../lib/adminTeam';
import { useDynamicTitle } from '../../hooks/useDynamicTitle';
import { useWakeLock } from '../../hooks/useWakeLock';
import { getNewIncomingOrderIds } from '../../admin/notifications';
import {
  ORDER_QUEUE_VIEWS,
  TERMINAL_ORDER_STATUSES,
  filterOrdersByQueue,
  getOrderQueueSummary,
  type OrderQueueView,
} from '../../admin/orderQueues';
import {
  buildFeedbackHeadline,
  buildFeedbackQuote,
  getAdminGuestDisplayName,
  getOrderClockLabel,
} from '../../admin/feedbackPresentation';
import { buildRevenueExport, isOperationalRevenueOrder } from '../../admin/revenue';
import { resolveAdminSession, type AdminRole } from '../../admin/session';

type AdminTab = 'orders' | 'menu' | 'feedback' | 'revenue' | 'handover' | 'settings';
type ShiftName = 'morning' | 'afternoon' | 'night';
type OperatingDayName = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

interface AdminIdentity {
  uid: string;
  email: string;
  name: string;
  role: AdminRole;
  hotelId: string;
  username: string;
}

interface MenuProduct {
  id: string;
  sourceItemId?: string;
  name: string;
  category: string;
  price: number;
  image: string;
  description: string;
  isAvailable: boolean;
  unavailableReason?: string;
}

interface OrderLine {
  id: string;
  name: string;
  qty: number;
  price: number;
  note: string;
}

interface DashboardOrder {
  id: string;
  roomNumber: string;
  lastName: string;
  phoneNumber: string;
  status: string;
  items: OrderLine[];
  createdAt: Date | null;
  total: number;
  paymentMethod: string;
  isRead: boolean;
  source: string;
  guestUid: string;
  accessTokenId: string;
  feedbackText: string;
  feedbackSummary: string;
  rating: number | null;
  managerFollowUpRequested: boolean;
}

interface MenuEditorState {
  id?: string;
  name: string;
  category: string;
  price: string;
  description: string;
  image: string;
  isAvailable: boolean;
  unavailableReason: string;
}

interface ShiftNote {
  id: string;
  shift: ShiftName;
  note: string;
  authorName: string;
  authorUid: string;
  createdAt: Date | null;
}

interface StaffAccount {
  uid: string;
  name: string;
  email: string;
  username: string;
  role: AdminRole;
  active: boolean;
  createdAt: Date | null;
  lastUpdatedAt: Date | null;
}

interface StaffEditorState {
  uid?: string;
  name: string;
  email: string;
  username: string;
  role: AdminRole;
  active: boolean;
  password: string;
}

interface RevenueMenuLeader {
  name: string;
  image: string;
  orders: number;
  revenue: number;
}

interface RevenueSegment {
  label: string;
  revenue: number;
  percent: number;
}

interface RevenueTrendPoint {
  label: string;
  value: number;
}

interface ConfirmDialogState {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
  icon?: string;
  onConfirm: () => void | Promise<void>;
}

interface OperatingHour {
  day: OperatingDayName;
  enabled: boolean;
  opensAt: string;
  closesAt: string;
}

interface AlertPreference {
  id: string;
  title: string;
  copy: string;
  enabled: boolean;
}

type FirestoreRestValue =
  | { stringValue?: string }
  | { integerValue?: string }
  | { doubleValue?: number }
  | { booleanValue?: boolean }
  | { timestampValue?: string }
  | { nullValue?: null };

interface FirestoreRestDocument {
  name: string;
}

const TERMINAL_STATUSES = TERMINAL_ORDER_STATUSES;
const SLA_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

// State-machine compliance (agent_rule.txt): explicit states + terminal set
const ORDER_STATES = {
  INCOMING: 'incoming',
  PREPARING: 'preparing',
  READY: 'ready',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

// Pure guard — no side effects
function isTerminalStatus(status: string): boolean {
  return status === ORDER_STATES.DELIVERED || status === ORDER_STATES.COMPLETED || status === ORDER_STATES.CANCELLED;
}
const CLOUD_WRITE_TIMEOUT_MS = 8000;
const LOCAL_SHIFT_NOTES_KEY = 'admindashboardcomponent_shift_notes';
const LOCAL_PRODUCTS_KEY = 'admindashboardcomponent_menu_products';
const LOCAL_HIDDEN_ORDER_IDS_KEY = 'admindashboardcomponent_hidden_order_ids';

const STATUS_COLORS: Record<string, string> = {
  incoming: 'bg-blue-50 text-blue-800',
  confirmed: 'bg-indigo-50 text-indigo-800',
  kitchen: 'bg-orange-50 text-orange-800',
  preparing: 'bg-orange-50 text-orange-800',
  quality_check: 'bg-purple-50 text-purple-800',
  delivery: 'bg-yellow-50 text-yellow-800',
  on_the_way: 'bg-yellow-50 text-yellow-800',
  delivered: 'bg-emerald-50 text-emerald-800',
  completed: 'bg-[#e9e8e6] text-[#1a1c1b]',
  cancelled: 'bg-[#ffdad6] text-[#93000a]',
};

const SHIFT_LABELS: Record<ShiftName, string> = {
  morning: 'Morning — 06:00–14:00',
  afternoon: 'Afternoon — 14:00–22:00',
  night: 'Night — 22:00–06:00',
};

const BRAND_LOGO_URL = 'https://i.ibb.co.com/B2YJXXG0/Logo-ciputra-copy.png';
const OPERATING_DAYS: OperatingDayName[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEFAULT_OPERATING_HOURS: OperatingHour[] = OPERATING_DAYS.map((day) => ({
  day,
  enabled: true,
  opensAt: '06:00',
  closesAt: '23:30',
}));
const DEFAULT_ALERT_PREFERENCES: AlertPreference[] = [
  { id: 'newOrderChime', title: 'New Order Chime', copy: 'Audible alert on kitchen tablets.', enabled: true },
  { id: 'vipGuestAlert', title: 'VIP Guest Alert', copy: 'SMS notification to duty manager.', enabled: true },
  { id: 'delayedOrderWarning', title: 'Delayed Order Warning', copy: 'Alerts after prep time threshold.', enabled: true },
  { id: 'dailyRevenueDigest', title: 'Daily Revenue Digest', copy: 'Email sent at end of service.', enabled: false },
];

const TAB_SEARCH_PLACEHOLDERS: Record<AdminTab, string> = {
  orders: 'Search orders...',
  menu: 'Search menu...',
  feedback: 'Search feedback...',
  revenue: 'Search revenue...',
  handover: 'Search notes...',
  settings: 'Search settings...',
};

const ELEVATED_PANEL_CLASS = 'rounded-lg bg-white shadow-[0_10px_30px_rgba(26,28,27,0.03)] border border-[#d1c5b4]/20';
const TONAL_PANEL_CLASS = 'rounded-lg bg-[#f4f3f1] border border-[#d1c5b4]/20';

function getFirestoreRestBaseUrl(): string {
  return `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
}

function getFirestoreDocumentId(documentName: string): string {
  return documentName.split('/').pop() || '';
}

function writeFirestoreRestValue(value: unknown): FirestoreRestValue {
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value === null || typeof value === 'undefined') return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: String(value) };
}

async function fetchJsonWithTimeout<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CLOUD_WRITE_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`rest-${response.status}`);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('timeout');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken().catch(() => '');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function patchFirestoreDocument(
  collectionName: string,
  docId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const updateMask = Object.keys(payload)
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join('&');
  await fetchJsonWithTimeout<FirestoreRestDocument>(
    `${getFirestoreRestBaseUrl()}/${collectionName}/${encodeURIComponent(docId)}?key=${firebaseConfig.apiKey}&${updateMask}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...await getAuthHeaders() },
      body: JSON.stringify({
        fields: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, writeFirestoreRestValue(value)])),
      }),
    },
  );
}

async function createFirestoreDocument(collectionName: string, payload: Record<string, unknown>): Promise<string> {
  const document = await fetchJsonWithTimeout<FirestoreRestDocument>(
    `${getFirestoreRestBaseUrl()}/${collectionName}?key=${firebaseConfig.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...await getAuthHeaders() },
      body: JSON.stringify({
        fields: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, writeFirestoreRestValue(value)])),
      }),
    },
  );
  return getFirestoreDocumentId(document.name);
}

function withTimeout<T>(promise: Promise<T>, message = 'timeout'): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), CLOUD_WRITE_TIMEOUT_MS);
    }),
  ]);
}

function loadLocalProducts(): MenuProduct[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_PRODUCTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as MenuProduct[];
  } catch {
    return [];
  }
}

function saveLocalProducts(products: MenuProduct[]): void {
  const prioritizedProducts = products.slice(0, 200);
  const attempts = [prioritizedProducts, prioritizedProducts.slice(0, 75), prioritizedProducts.slice(0, 25), prioritizedProducts.slice(0, 10), prioritizedProducts.slice(0, 5), prioritizedProducts.slice(0, 1)];

  for (const attempt of attempts) {
    try {
      window.localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify(attempt));
      return;
    } catch {
      // Keep trying smaller snapshots so the newest menu edit still survives quota pressure.
    }
  }
}

function upsertLocalProduct(product: MenuProduct): void {
  const current = loadLocalProducts();
  const next = [product, ...current.filter((item) => item.id !== product.id)];
  saveLocalProducts(next);
}

function removeLocalProduct(productId: string): void {
  saveLocalProducts(loadLocalProducts().filter((item) => item.id !== productId));
}

function mergeProducts(remoteProducts: MenuProduct[]): MenuProduct[] {
  const byId = new Map<string, MenuProduct>();
  for (const product of [...remoteProducts, ...loadLocalProducts()]) {
    byId.set(product.id, product);
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      result ? resolve(result) : reject(new Error('empty-image'));
    };
    reader.onerror = () => reject(new Error('image-read-failed'));
    reader.readAsDataURL(file);
  });
}

function compressMenuImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const targets = [
        { maxSize: 1280, quality: 0.82 },
        { maxSize: 960, quality: 0.76 },
        { maxSize: 720, quality: 0.7 },
      ];
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('canvas-unavailable'));
        return;
      }

      let output = dataUrl;
      for (const target of targets) {
        const scale = Math.min(1, target.maxSize / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        canvas.width = width;
        canvas.height = height;
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        output = canvas.toDataURL('image/jpeg', target.quality);
        if (output.length < 850_000) break;
      }

      resolve(output);
    };
    image.onerror = () => reject(new Error('image-load-failed'));
    image.src = dataUrl;
  });
}

async function prepareMenuImage(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  if (file.type === 'image/svg+xml') return dataUrl;
  try {
    return await compressMenuImage(dataUrl);
  } catch {
    return dataUrl;
  }
}

async function prepareMenuImageDataUrl(dataUrl: string): Promise<string> {
  try {
    return await compressMenuImage(dataUrl);
  } catch {
    return dataUrl;
  }
}

function isPickerCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|cancelled|canceled|dismiss/i.test(message);
}

function loadLocalHiddenOrderIds(): string[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_HIDDEN_ORDER_IDS_KEY);
    return raw ? JSON.parse(raw) as string[] : [];
  } catch {
    return [];
  }
}

function saveLocalHiddenOrderIds(orderIds: string[]): void {
  window.localStorage.setItem(LOCAL_HIDDEN_ORDER_IDS_KEY, JSON.stringify(Array.from(new Set(orderIds)).slice(0, 300)));
}

function loadLocalShiftNotes(): ShiftNote[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_SHIFT_NOTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Omit<ShiftNote, 'createdAt'> & { createdAt: string | null }>;
    return parsed.map((note) => ({
      ...note,
      createdAt: note.createdAt ? new Date(note.createdAt) : null,
    }));
  } catch {
    return [];
  }
}

function persistLocalShiftNote(note: ShiftNote): void {
  const next = [note, ...loadLocalShiftNotes()].slice(0, 80);
  window.localStorage.setItem(LOCAL_SHIFT_NOTES_KEY, JSON.stringify(next.map((item) => ({
    ...item,
    createdAt: item.createdAt ? item.createdAt.toISOString() : null,
  }))));
}

function mergeShiftNotes(remoteNotes: ShiftNote[]): ShiftNote[] {
  const byId = new Map<string, ShiftNote>();
  for (const note of [...loadLocalShiftNotes(), ...remoteNotes]) {
    byId.set(note.id, note);
  }
  return Array.from(byId.values()).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
}

function normalizeRole(role: unknown): AdminRole {
  return role === 'staff' ? 'staff' : 'manager';
}

function getAdminLoginErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  const message = (err as { message?: string })?.message || '';

  if (code.includes('invalid-api-key') || message.toLowerCase().includes('api key')) {
    return 'Firebase API key admin tidak valid. Refresh build app setelah config diperbaiki.';
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Email atau password admin tidak cocok.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Login sementara dibatasi karena terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Login gagal karena koneksi ke Firebase terputus. Cek internet simulator.';
  }

  return `Login gagal${code ? ` (${code})` : ''}. Pastikan akun manager atau staff aktif di Firebase Auth.`;
}

function formatIdr(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(value);
}

function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return `${Math.round(value)}`;
}

function formatStatusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return 'Unknown time';
  const diffMinutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatFeedbackTime(date: Date | null): string {
  if (!date) return 'Recently';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function getWeekStart(date: Date): Date {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(date, offset));
}

function isWithinRange(date: Date | null, start: Date, end: Date): boolean {
  if (!date) return false;
  return date >= start && date < end;
}

function getRevenuePeriodBounds(anchor: Date, range: 'daily' | 'weekly' | 'monthly'): {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
} {
  if (range === 'weekly') {
    const currentStart = getWeekStart(anchor);
    const currentEnd = addDays(currentStart, 7);
    return {
      currentStart,
      currentEnd,
      previousStart: addDays(currentStart, -7),
      previousEnd: currentStart,
    };
  }

  if (range === 'monthly') {
    const currentStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const currentEnd = addMonths(currentStart, 1);
    return {
      currentStart,
      currentEnd,
      previousStart: addMonths(currentStart, -1),
      previousEnd: currentStart,
    };
  }

  const currentStart = startOfDay(anchor);
  const currentEnd = addDays(currentStart, 1);
  return {
    currentStart,
    currentEnd,
    previousStart: addDays(currentStart, -1),
    previousEnd: currentStart,
  };
}

function getOrderNextAction(status: string): { label: string; nextStatus: string } | null {
  switch (status) {
    case 'incoming':
    case 'confirmed':
      return { label: 'Send to Kitchen', nextStatus: 'preparing' };
    case 'kitchen':
      return { label: 'Start Prep', nextStatus: 'preparing' };
    case 'preparing':
      return { label: 'Mark Ready', nextStatus: 'quality_check' };
    case 'quality_check':
      return { label: 'Dispatch Order', nextStatus: 'delivery' };
    case 'delivery':
      return { label: 'On The Way', nextStatus: 'on_the_way' };
    case 'on_the_way':
      return { label: 'Mark Delivered', nextStatus: 'delivered' };
    case 'delivered':
      return { label: 'Complete Order', nextStatus: 'completed' };
    default:
      return null;
  }
}

function isOrderSlaBreached(order: DashboardOrder): boolean {
  if (!order.createdAt || isTerminalStatus(order.status)) return false;
  return Date.now() - order.createdAt.getTime() > SLA_THRESHOLD_MS;
}

function canRevokeOrderAccess(order: DashboardOrder): boolean {
  return !isTerminalStatus(order.status) && Boolean(order.guestUid || order.accessTokenId);
}

function normalizeProduct(docId: string, data: Record<string, unknown>): MenuProduct {
  return {
    id: docId,
    sourceItemId: typeof data.sourceItemId === 'string' ? data.sourceItemId : undefined,
    name: typeof data.name === 'string' ? data.name : 'Untitled item',
    category: typeof data.category === 'string' ? data.category : 'Mains',
    price: typeof data.price === 'number' ? data.price : 0,
    image: typeof data.image === 'string' ? data.image : '',
    description: typeof data.description === 'string' ? data.description : '',
    isAvailable: data.isAvailable !== false,
    unavailableReason: typeof data.unavailableReason === 'string' ? data.unavailableReason : '',
  };
}

function normalizeOrder(docId: string, data: Record<string, unknown>): DashboardOrder {
  const feedbackDetails = typeof data.feedbackDetails === 'object' && data.feedbackDetails
    ? data.feedbackDetails as Record<string, unknown>
    : null;
  const rawItems = Array.isArray(data.items) ? data.items : [];

  return {
    id: docId,
    roomNumber: typeof data.roomNumber === 'string' ? data.roomNumber : 'Unassigned',
    lastName: typeof data.lastName === 'string' ? data.lastName : '',
    phoneNumber: typeof data.phoneNumber === 'string' ? data.phoneNumber : '',
    status: typeof data.status === 'string' ? data.status : 'incoming',
    items: rawItems.map((item, index) => {
      const row = (item && typeof item === 'object') ? item as Record<string, unknown> : {};
      return {
        id: typeof row.id === 'string' ? row.id : `${docId}-${index}`,
        name: typeof row.name === 'string' ? row.name : 'Menu item unavailable',
        qty: typeof row.qty === 'number' ? row.qty : typeof row.quantity === 'number' ? row.quantity : 1,
        price: typeof row.price === 'number' ? row.price : 0,
        note: typeof row.note === 'string' ? row.note : '',
      };
    }),
    createdAt: data.createdAt && typeof data.createdAt === 'object' && 'toDate' in data.createdAt
      ? (data.createdAt as { toDate: () => Date }).toDate()
      : null,
    total: typeof data.total === 'number' ? data.total : 0,
    paymentMethod: typeof data.paymentMethod === 'string' ? data.paymentMethod : 'room',
    isRead: data.isRead === true,
    source: typeof data.source === 'string' ? data.source : '',
    guestUid: typeof data.guestUid === 'string' ? data.guestUid : '',
    accessTokenId: typeof data.accessTokenId === 'string' ? data.accessTokenId : '',
    feedbackText: feedbackDetails && typeof feedbackDetails.comment === 'string'
      ? feedbackDetails.comment
      : typeof data.feedback === 'string' ? data.feedback : '',
    feedbackSummary: typeof data.reviewSummary === 'string'
      ? data.reviewSummary
      : typeof data.feedback === 'string' ? data.feedback : '',
    rating: feedbackDetails && typeof feedbackDetails.overallRating === 'number'
      ? feedbackDetails.overallRating
      : typeof data.rating === 'number' ? data.rating : null,
    managerFollowUpRequested:
      feedbackDetails?.requestManagerFollowUp === true
      || data.requestManagerFollowUp === true
      || data.requestManagerFollowUp === 'yes',
  };
}

function normalizeShiftNote(docId: string, data: Record<string, unknown>): ShiftNote {
  return {
    id: docId,
    shift: (['morning', 'afternoon', 'night'].includes(data.shift as string)
      ? data.shift as ShiftName
      : 'morning'),
    note: typeof data.note === 'string' ? data.note : '',
    authorName: typeof data.authorName === 'string' ? data.authorName : 'Unknown',
    authorUid: typeof data.authorUid === 'string' ? data.authorUid : '',
    createdAt: data.createdAt && typeof data.createdAt === 'object' && 'toDate' in data.createdAt
      ? (data.createdAt as { toDate: () => Date }).toDate()
      : null,
  };
}

function normalizeStaffAccount(docId: string, data: Record<string, unknown>): StaffAccount {
  return {
    uid: docId,
    name: typeof data.name === 'string' ? data.name : 'Unknown',
    email: typeof data.email === 'string' ? data.email : '',
    username: typeof data.username === 'string' ? data.username : '',
    role: normalizeRole(data.role),
    active: data.active !== false,
    createdAt: data.createdAt && typeof data.createdAt === 'object' && 'toDate' in data.createdAt
      ? (data.createdAt as { toDate: () => Date }).toDate()
      : null,
    lastUpdatedAt: data.updatedAt && typeof data.updatedAt === 'object' && 'toDate' in data.updatedAt
      ? (data.updatedAt as { toDate: () => Date }).toDate()
      : null,
  };
}

function getEditorState(product?: MenuProduct): MenuEditorState {
  return {
    id: product?.id,
    name: product?.name || '',
    category: product?.category || 'Mains',
    price: product ? String(product.price) : '',
    description: product?.description || '',
    image: product?.image || '',
    isAvailable: product ? product.isAvailable : true,
    unavailableReason: product?.unavailableReason || '',
  };
}

function getStaffEditorState(staff?: StaffAccount): StaffEditorState {
  return {
    uid: staff?.uid,
    name: staff?.name || '',
    email: staff?.email || '',
    username: staff?.username || '',
    role: staff?.role || 'staff',
    active: staff ? staff.active : true,
    password: '',
  };
}

function normalizeOperatingHours(value: unknown): OperatingHour[] {
  if (!Array.isArray(value)) return DEFAULT_OPERATING_HOURS;
  return DEFAULT_OPERATING_HOURS.map((fallback) => {
    const row = value.find((item) => (
      item && typeof item === 'object' && (item as Record<string, unknown>).day === fallback.day
    )) as Record<string, unknown> | undefined;
    return {
      day: fallback.day,
      enabled: typeof row?.enabled === 'boolean' ? row.enabled : fallback.enabled,
      opensAt: typeof row?.opensAt === 'string' ? row.opensAt : fallback.opensAt,
      closesAt: typeof row?.closesAt === 'string' ? row.closesAt : fallback.closesAt,
    };
  });
}

function normalizeAlertPreferences(value: unknown): AlertPreference[] {
  if (!Array.isArray(value)) return DEFAULT_ALERT_PREFERENCES;
  return DEFAULT_ALERT_PREFERENCES.map((fallback) => {
    const row = value.find((item) => (
      item && typeof item === 'object' && (item as Record<string, unknown>).id === fallback.id
    )) as Record<string, unknown> | undefined;
    return {
      ...fallback,
      enabled: typeof row?.enabled === 'boolean' ? row.enabled : fallback.enabled,
    };
  });
}

function downloadExcelFile(filename: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  const widths = ['58%', '76%', '64%', '82%', '70%', '60%'];
  return (
    <div className={`${ELEVATED_PANEL_CLASS} p-8 space-y-4 animate-pulse`}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="flex gap-4 items-center">
          <div className="h-4 bg-[#e9e8e6] rounded w-1/4" />
          <div className="h-4 bg-[#e9e8e6] rounded" style={{ width: widths[i % widths.length] }} />
        </div>
      ))}
    </div>
  );
}

function ManagerOnly({ children, role }: { children: React.ReactNode; role: AdminRole }) {
  if (role === 'manager') return <>{children}</>;

  return (
    <div className={`${TONAL_PANEL_CLASS} p-8`}>
      <div className="flex items-start gap-4">
        <span className="material-symbols-outlined text-[#775a19] mt-0.5 text-[20px]">shield</span>
        <div>
          <p className="font-['Manrope'] text-sm font-semibold text-[#1a1c1b]">Manager access only</p>
          <p className="mt-1 font-['Manrope'] text-sm leading-6 text-[#4e4639]">
            This section is limited to manager accounts.
          </p>
        </div>
      </div>
    </div>
  );
}

function UnderlineInput({
  id, label, type = 'text', value, placeholder, onChange,
}: {
  id: string; label: string; type?: string;
  value: string; placeholder?: string; onChange: (v: string) => void;
}) {
  return (
    <div className="group relative border-b border-[#d1c5b4]/50 focus-within:border-[#775a19] transition-colors pb-1">
      <label htmlFor={id} className="block font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] mb-2">
        {label}
      </label>
      <input
        id={id} type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full bg-transparent border-none focus:ring-0 outline-none font-['Manrope'] text-sm text-[#1a1c1b] placeholder:text-[#4e4639]/40 py-1"
      />
    </div>
  );
}

export default function HouseApp() {
  const [authReady, setAuthReady] = useState(false);
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [authError, setAuthError] = useState('');
  const [loginForm, setLoginForm] = useState({ credential: '', password: '' });
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('orders');

  // Data
  const [orders, setOrders] = useState<DashboardOrder[]>([]);
  const [products, setProducts] = useState<MenuProduct[]>([]);
  const [shiftNotes, setShiftNotes] = useState<ShiftNote[]>([]);
  const [staffAccounts, setStaffAccounts] = useState<StaffAccount[]>([]);

  const [dataLoaded, setDataLoaded] = useState(false);

  // UI state
  const [shellSearch, setShellSearch] = useState('');
  const [editingProduct, setEditingProduct] = useState<MenuEditorState | null>(null);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | '5' | '4' | 'week'>('all');
  const [revenueRange, setRevenueRange] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [ordersAttentionOnly, setOrdersAttentionOnly] = useState(false);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [orderQueueView, setOrderQueueView] = useState<OrderQueueView>('active');
  const [isOrderIntakePaused, setIsOrderIntakePaused] = useState(false);
  const [hiddenOrderIds, setHiddenOrderIds] = useState<string[]>(() => loadLocalHiddenOrderIds());
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isProcessingMenuImage, setIsProcessingMenuImage] = useState(false);
  const menuImageInputRef = useRef<HTMLInputElement | null>(null);

  // Settings / QR
  const [hotelId, setHotelId] = useState('');
  const [operatingHours, setOperatingHours] = useState<OperatingHour[]>(DEFAULT_OPERATING_HOURS);
  const [taxRate, setTaxRate] = useState('');
  const [surchargeRate, setSurchargeRate] = useState('');
  const [alertPreferences, setAlertPreferences] = useState<AlertPreference[]>(DEFAULT_ALERT_PREFERENCES);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [teamStatus, setTeamStatus] = useState('');
  const [staffEditor, setStaffEditor] = useState<StaffEditorState | null>(null);
  const [isSavingStaff, setIsSavingStaff] = useState(false);
  const [passwordResetUid, setPasswordResetUid] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [isConfirmingDialog, setIsConfirmingDialog] = useState(false);

  // Shift handover
  const [activeShift, setActiveShift] = useState<ShiftName>('morning');
  const [handoverDraft, setHandoverDraft] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);

  const previousOrdersRef = useRef<DashboardOrder[]>([]);
  // SLA ticker — re-renders every 60s so SLA badges stay live
  const [, setSlaTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSlaTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  /* ── Derived state ── */
  const unreadIncomingOrders = useMemo(
    () => orders.filter((o) => o.status === 'incoming' && !o.isRead),
    [orders],
  );
  const activeOrders = useMemo(
    () => filterOrdersByQueue(orders, 'active', hiddenOrderIds),
    [hiddenOrderIds, orders],
  );
  const orderQueueSummary = useMemo(
    () => getOrderQueueSummary(orders, hiddenOrderIds),
    [hiddenOrderIds, orders],
  );
  const selectedQueueOrders = useMemo(
    () => filterOrdersByQueue(orders, orderQueueView, hiddenOrderIds),
    [hiddenOrderIds, orderQueueView, orders],
  );
  const todayOrders = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return activeOrders.filter((o) => {
      if (!o.createdAt) return true;
      return o.createdAt >= startOfToday;
    });
  }, [activeOrders]);
  const slaBreachedCount = useMemo(
    () => orders.filter(isOrderSlaBreached).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders],
  );
  const feedbackOrders = useMemo(
    () => orders.filter((o) => o.rating !== null || Boolean(o.feedbackText) || Boolean(o.feedbackSummary)),
    [orders],
  );
  const needsReviewOrders = useMemo(
    () => orders.filter((o) => o.managerFollowUpRequested || (o.rating !== null && o.rating <= 3)),
    [orders],
  );
  const averageRating = useMemo(() => {
    const rated = orders.filter((o) => o.rating !== null);
    if (!rated.length) return '-';
    return (rated.reduce((s, o) => s + Number(o.rating || 0), 0) / rated.length).toFixed(1);
  }, [orders]);
  const averagePrepMinutes = useMemo(() => {
    const timedOrders = activeOrders.filter((order) => order.createdAt);
    if (!timedOrders.length) return 0;
    const totalMinutes = timedOrders.reduce((sum, order) => (
      sum + Math.max(1, Math.round((Date.now() - (order.createdAt as Date).getTime()) / 60000))
    ), 0);
    return Math.round(totalMinutes / timedOrders.length);
  }, [activeOrders]);
  const activeSearchQuery = shellSearch.trim().toLowerCase();
  const filteredProducts = useMemo(() => {
    const q = (activeTab === 'menu' ? shellSearch : '').trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
    );
  }, [activeTab, products, shellSearch]);
  const menuCategories = useMemo(() => ['All', ...Array.from(new Set(products.map((p) => p.category)))], [products]);
  const [activeMenuCategory, setActiveMenuCategory] = useState('All');
  const visibleProducts = useMemo(() => (
    activeMenuCategory === 'All'
      ? filteredProducts
      : filteredProducts.filter((product) => product.category === activeMenuCategory)
  ), [activeMenuCategory, filteredProducts]);
  const revenueAnchorDate = useMemo(() => new Date(`${selectedDate}T12:00:00`), [selectedDate]);
  const revenuePeriodBounds = useMemo(
    () => getRevenuePeriodBounds(revenueAnchorDate, revenueRange),
    [revenueAnchorDate, revenueRange],
  );
  const operationalRevenueOrders = useMemo(
    () => orders.filter((order) => isOperationalRevenueOrder(order)),
    [orders],
  );
  const revenueRows = useMemo(
    () => operationalRevenueOrders
      .filter((order) => ['delivered', 'completed'].includes(order.status))
      .filter((order) => isWithinRange(order.createdAt, revenuePeriodBounds.currentStart, revenuePeriodBounds.currentEnd))
      .map((order) => ({
        id: order.id,
        roomNumber: order.roomNumber,
        paymentMethod: order.paymentMethod,
        total: order.total,
        createdAt: order.createdAt as Date,
      })),
    [operationalRevenueOrders, revenuePeriodBounds],
  );
  const previousRevenueRows = useMemo(
    () => operationalRevenueOrders
      .filter((order) => ['delivered', 'completed'].includes(order.status))
      .filter((order) => isWithinRange(order.createdAt, revenuePeriodBounds.previousStart, revenuePeriodBounds.previousEnd))
      .map((order) => ({
        id: order.id,
        roomNumber: order.roomNumber,
        paymentMethod: order.paymentMethod,
        total: order.total,
        createdAt: order.createdAt as Date,
      })),
    [operationalRevenueOrders, revenuePeriodBounds],
  );
  const revenueSummary = useMemo(() => ({
    kpi: {
      revenue: revenueRows.reduce((sum, row) => sum + row.total, 0),
      completedOrders: revenueRows.length,
      cancelledOrders: operationalRevenueOrders.filter(
        (order) => order.status === 'cancelled'
          && isWithinRange(order.createdAt, revenuePeriodBounds.currentStart, revenuePeriodBounds.currentEnd),
      ).length,
    },
    rows: revenueRows,
  }), [operationalRevenueOrders, revenuePeriodBounds, revenueRows]);
  const revenueOverview = useMemo(() => {
    const currentRevenue = revenueRows.reduce((sum, row) => sum + row.total, 0);
    const previousRevenue = previousRevenueRows.reduce((sum, row) => sum + row.total, 0);
    const averageOrderValue = revenueRows.length ? currentRevenue / revenueRows.length : 0;
    const previousAverage = previousRevenueRows.length ? previousRevenue / previousRevenueRows.length : 0;
    const totalOrders = revenueRows.length;
    const previousOrders = previousRevenueRows.length;
    const getDelta = (current: number, previous: number) => {
      if (!previous) return current ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };
    return {
      revenue: currentRevenue,
      averageOrderValue,
      totalOrders,
      revenueDelta: getDelta(currentRevenue, previousRevenue),
      averageDelta: getDelta(averageOrderValue, previousAverage),
      ordersDelta: getDelta(totalOrders, previousOrders),
    };
  }, [previousRevenueRows, revenueRows]);
  const revenueTrend = useMemo<RevenueTrendPoint[]>(() => {
    if (revenueRange === 'monthly') {
      const start = new Date(revenueAnchorDate.getFullYear(), revenueAnchorDate.getMonth(), 1);
      const labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
      return labels.map((label, index) => {
        const bucketStart = addDays(start, index * 7);
        const bucketEnd = index === labels.length - 1 ? addMonths(start, 1) : addDays(start, (index + 1) * 7);
        const value = operationalRevenueOrders
          .filter((order) => ['delivered', 'completed'].includes(order.status))
          .filter((order) => isWithinRange(order.createdAt, bucketStart, bucketEnd))
          .reduce((sum, order) => sum + order.total, 0);
        return { label, value };
      });
    }

    const start = revenueRange === 'weekly' ? revenuePeriodBounds.currentStart : addDays(startOfDay(revenueAnchorDate), -6);
    const totalPoints = revenueRange === 'weekly' ? 7 : 7;
    return Array.from({ length: totalPoints }, (_, index) => {
      const bucketStart = addDays(start, index);
      const bucketEnd = addDays(bucketStart, 1);
      const value = operationalRevenueOrders
        .filter((order) => ['delivered', 'completed'].includes(order.status))
        .filter((order) => isWithinRange(order.createdAt, bucketStart, bucketEnd))
        .reduce((sum, order) => sum + order.total, 0);
      const label = bucketStart.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      return { label, value };
    });
  }, [operationalRevenueOrders, revenueAnchorDate, revenuePeriodBounds.currentStart, revenueRange]);
  const revenueLeaders = useMemo<RevenueMenuLeader[]>(() => {
    const completedOrders = operationalRevenueOrders.filter((order) => (
      ['delivered', 'completed'].includes(order.status)
      && isWithinRange(order.createdAt, revenuePeriodBounds.currentStart, revenuePeriodBounds.currentEnd)
    ));
    const byItem = new Map<string, RevenueMenuLeader>();
    for (const order of completedOrders) {
      for (const item of order.items) {
        const current = byItem.get(item.name);
        const matchedProduct = products.find((product) => product.name === item.name);
        byItem.set(item.name, {
          name: item.name,
          image: current?.image || matchedProduct?.image || '',
          orders: (current?.orders || 0) + item.qty,
          revenue: (current?.revenue || 0) + (item.qty * item.price),
        });
      }
    }
    return Array.from(byItem.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 4);
  }, [operationalRevenueOrders, products, revenuePeriodBounds]);
  const revenueDistribution = useMemo<RevenueSegment[]>(() => {
    const completedOrders = operationalRevenueOrders.filter((order) => (
      ['delivered', 'completed'].includes(order.status)
      && isWithinRange(order.createdAt, revenuePeriodBounds.currentStart, revenuePeriodBounds.currentEnd)
    ));
    const totals = new Map<string, number>();
    for (const order of completedOrders) {
      const hour = order.createdAt ? order.createdAt.getHours() : 0;
      const label = hour < 14
        ? 'Breakfast / Brunch'
        : hour < 18
          ? 'Beverage & Wine'
          : 'Dinner Service';
      totals.set(label, (totals.get(label) || 0) + order.total);
    }
    const totalRevenue = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
    return Array.from(totals.entries())
      .map(([label, revenue]) => ({
        label,
        revenue,
        percent: totalRevenue ? Math.round((revenue / totalRevenue) * 100) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 3);
  }, [operationalRevenueOrders, revenuePeriodBounds]);
  const visibleRevenueLeaders = useMemo(() => {
    const queryText = activeTab === 'revenue' ? activeSearchQuery : '';
    if (!queryText) return revenueLeaders;
    return revenueLeaders.filter((item) => item.name.toLowerCase().includes(queryText));
  }, [activeSearchQuery, activeTab, revenueLeaders]);
  const visibleRevenueDistribution = useMemo(() => {
    const queryText = activeTab === 'revenue' ? activeSearchQuery : '';
    if (!queryText) return revenueDistribution;
    return revenueDistribution.filter((segment) => segment.label.toLowerCase().includes(queryText));
  }, [activeSearchQuery, activeTab, revenueDistribution]);
  const visibleOrders = useMemo(() => {
    const useToday = orderQueueView === 'active' && !showAllOrders;
    const pool = useToday ? todayOrders : selectedQueueOrders;
    const queryText = activeTab === 'orders' ? activeSearchQuery : '';
    return pool.filter((order) => {
      if (
        orderQueueView === 'active'
        && ordersAttentionOnly
        && !(order.status === 'incoming' || !order.isRead || isOrderSlaBreached(order))
      ) return false;
      if (!queryText) return true;
      return [
        order.roomNumber,
        order.lastName,
        order.status,
        ...order.items.map((item) => item.name),
      ].some((value) => value.toLowerCase().includes(queryText));
    });
  }, [activeSearchQuery, activeTab, orderQueueView, ordersAttentionOnly, selectedQueueOrders, showAllOrders, todayOrders]);
  const visibleStaffAccounts = useMemo(() => {
    const queryText = (activeTab === 'settings' ? shellSearch : '').trim().toLowerCase();
    if (!queryText) return staffAccounts;
    return staffAccounts.filter((staff) => (
      [staff.name, staff.email, staff.username, staff.role].some((value) => value.toLowerCase().includes(queryText))
    ));
  }, [activeTab, shellSearch, staffAccounts]);
  const shiftNotesByShift = useMemo(() => {
    const queryText = activeTab === 'handover' ? activeSearchQuery : '';
    const out: Record<ShiftName, ShiftNote[]> = { morning: [], afternoon: [], night: [] };
    for (const n of shiftNotes) {
      const matchesSearch = !queryText || [
        n.shift,
        n.note,
        n.authorName,
      ].some((value) => value.toLowerCase().includes(queryText));
      if (matchesSearch) out[n.shift].push(n);
    }
    return out;
  }, [activeSearchQuery, activeTab, shiftNotes]);
  const filteredFeedbackOrders = useMemo(() => {
    const queryText = activeTab === 'feedback' ? activeSearchQuery : '';
    return feedbackOrders.filter((order) => {
      const matchesSearch = !queryText || [
        order.roomNumber,
        order.lastName,
        order.feedbackText,
        order.feedbackSummary,
      ].some((value) => value.toLowerCase().includes(queryText));
      const matchesFilter = feedbackFilter === 'all'
        || String(order.rating ?? '') === feedbackFilter
        || (
          feedbackFilter === 'week'
          && Boolean(order.createdAt)
          && (Date.now() - (order.createdAt as Date).getTime()) <= (7 * 24 * 60 * 60 * 1000)
        );
      return matchesSearch && matchesFilter;
    });
  }, [activeSearchQuery, activeTab, feedbackFilter, feedbackOrders]);
  const feedbackHeroOrder = filteredFeedbackOrders[0] || null;
  const feedbackSideOrder = filteredFeedbackOrders[1] || null;
  const feedbackIssueOrder = filteredFeedbackOrders.find((order) => (
    order.id !== feedbackHeroOrder?.id
    && order.id !== feedbackSideOrder?.id
    && (order.managerFollowUpRequested || (order.rating !== null && order.rating <= 3))
  )) || filteredFeedbackOrders[2] || null;
  const feedbackStoryOrder = filteredFeedbackOrders.find((order) => (
    order.id !== feedbackHeroOrder?.id
    && order.id !== feedbackSideOrder?.id
    && order.id !== feedbackIssueOrder?.id
  )) || filteredFeedbackOrders[3] || null;

  useDynamicTitle(unreadIncomingOrders.length);
  useWakeLock();

  // Auto-dismiss notifications after 6 seconds
  useEffect(() => {
    if (!notificationMessage) return;
    const timer = window.setTimeout(() => setNotificationMessage(''), 6000);
    return () => window.clearTimeout(timer);
  }, [notificationMessage]);

  // Escape key closes modals
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (staffEditor) { setStaffEditor(null); return; }
        if (editingProduct) { setEditingProduct(null); return; }
        if (confirmDialog && !isConfirmingDialog) { setConfirmDialog(null); return; }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [staffEditor, editingProduct, confirmDialog, isConfirmingDialog]);

  /* ── Auth ── */
  useEffect(() => {
    const readyFallback = window.setTimeout(() => {
      setAuthReady(true);
    }, 2500);

    const unsub = onAuthStateChanged(auth, async (user) => {
      window.clearTimeout(readyFallback);
      if (!user) { setIdentity(null); setAuthReady(true); return; }
      try {
        const resolved = await loadIdentity(user);
        setIdentity(resolved);
      } catch {
        setIdentity(null);
        setAuthError('Unexpected error loading session. Please try again.');
        await signOut(auth).catch(() => {});
      } finally {
        setAuthReady(true);
      }
    });
    return () => {
      window.clearTimeout(readyFallback);
      unsub();
    };
  }, []);

  /* ── Firestore subscriptions ── */
  useEffect(() => {
    if (!identity) { setOrders([]); setProducts([]); setShiftNotes([]); setStaffAccounts([]); setDataLoaded(false); return; }

    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc')),
      (snap) => {
        const next = snap.docs.map((d) => normalizeOrder(d.id, d.data() as Record<string, unknown>));
        const newIds = getNewIncomingOrderIds(previousOrdersRef.current, next);
        if (newIds.length > 0) {
          setNotificationMessage(
            newIds.length === 1 ? '1 pesanan baru masuk.' : `${newIds.length} pesanan baru masuk.`,
          );
        }
        previousOrdersRef.current = next;
        setOrders(next);
        setDataLoaded(true);
      },
    );

    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(mergeProducts(snap.docs.map((d) => normalizeProduct(d.id, d.data() as Record<string, unknown>))));
      setDataLoaded(true);
    }, (err) => {
      console.error('Products subscription error:', err.code, err.message);
      setDataLoaded(true);
    });

    const unsubNotes = onSnapshot(
      query(collection(db, 'shiftNotes'), orderBy('createdAt', 'desc'), limit(60)),
      (snap) => {
        const remoteNotes = snap.docs.map((d) => normalizeShiftNote(d.id, d.data() as Record<string, unknown>));
        setShiftNotes(mergeShiftNotes(remoteNotes));
      },
      (err) => {
        console.error('Failed to load shift notes', err);
        setShiftNotes(loadLocalShiftNotes());
      },
    );

    const unsubStaff = onSnapshot(collection(db, 'admin_users'), (snap) => {
      setStaffAccounts(
        snap.docs
          .map((d) => normalizeStaffAccount(d.id, d.data() as Record<string, unknown>))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    });

    return () => { unsubOrders(); unsubProducts(); unsubNotes(); unsubStaff(); };
  }, [identity]);

  useEffect(() => {
    if (!identity) {
      setHotelId('');
      return;
    }

    const settingsId = identity.hotelId || identity.uid;
    setHotelId(identity.hotelId);
    let cancelled = false;

    getDoc(doc(db, 'adminSettings', settingsId))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        setHotelId(typeof data.hotelId === 'string' ? data.hotelId : identity.hotelId);
        setOperatingHours(normalizeOperatingHours(data.operatingHours));
        setTaxRate(typeof data.taxRate === 'number' ? String(data.taxRate) : '');
        setSurchargeRate(typeof data.surchargeRate === 'number' ? String(data.surchargeRate) : '');
        setAlertPreferences(normalizeAlertPreferences(data.alertPreferences));
      })
      .catch((err) => {
        console.error('Failed to load admin settings', err);
        showDashboardNotice('Could not load saved settings. Check Firebase permission or connection.');
      });

    return () => {
      cancelled = true;
    };
  }, [identity]);

  /* ── Nav ── */
  const navItems = [
    { id: 'orders' as const, label: 'Live Orders', icon: 'restaurant', badge: unreadIncomingOrders.length || undefined },
    { id: 'revenue' as const, label: 'Revenue', icon: 'payments' },
    { id: 'menu' as const, label: 'Menu Manager', icon: 'menu_book' },
    { id: 'feedback' as const, label: 'Feedback', icon: 'reviews', badge: needsReviewOrders.length || undefined },
    { id: 'handover' as const, label: 'Handover Notes', icon: 'description' },
    { id: 'settings' as const, label: 'Settings', icon: 'settings' },
  ];

  /* ── Helpers ── */
  async function loadIdentity(user: User): Promise<AdminIdentity | null> {
    let profile: Record<string, unknown> | null = null;
    try {
      const snap = await getDoc(doc(db, 'admin_users', user.uid));
      profile = snap.exists() ? snap.data() : null;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'permission-denied') {
        setAuthError('Admin account not set up yet. Add your UID to admin_users in Firebase Console.');
      } else {
        setAuthError('Could not load admin profile. Check your internet connection.');
      }
      await signOut(auth);
      return null;
    }
    const session = resolveAdminSession({
      uid: user.uid,
      email: user.email || '',
      profile: profile
        ? { name: String(profile.name || 'Hotel Operator'), role: normalizeRole(profile.role as string), active: profile.active !== false }
        : null,
    });
    if (session.status !== 'authenticated') {
      setAuthError(session.reason === 'missing-profile'
        ? 'Admin account not found. Contact your manager to be added to admin_users.'
        : 'Account is inactive. Contact your manager.');
      await signOut(auth);
      return null;
    }
    return {
      uid: session.uid, email: session.email, name: session.name, role: session.role,
      hotelId: String(profile?.hotelId || ''),
      username: String(profile?.username || profile?.email || session.email),
    };
  }

  /* Audit trail — writes one doc to auditLog for every staff action */
  async function logAudit(
    action: string,
    targetType: 'order' | 'product' | 'guestSession' | 'shiftNote' | 'settings',
    targetId: string,
    details?: Record<string, unknown>,
  ) {
    if (!identity) return;
    try {
      await addDoc(collection(db, 'auditLog'), {
        uid: identity.uid,
        name: identity.name,
        role: identity.role,
        action,
        targetType,
        targetId,
        details: details ?? {},
        timestamp: serverTimestamp(),
      });
    } catch {
      // audit must never crash the main action
    }
  }

  function hasManagerAccess(action: string): boolean {
    if (identity?.role === 'manager') return true;
    showDashboardNotice(`Manager account required to ${action}.`);
    return false;
  }

  function hideOrderLocally(orderId: string): void {
    setHiddenOrderIds((current) => {
      const next = Array.from(new Set([orderId, ...current]));
      saveLocalHiddenOrderIds(next);
      return next;
    });
  }

  async function executeConfirmDialogAction() {
    if (!confirmDialog || isConfirmingDialog) return;
    const action = confirmDialog.onConfirm;
    setIsConfirmingDialog(true);
    try {
      await action();
      setConfirmDialog(null);
    } finally {
      setIsConfirmingDialog(false);
    }
  }

  /* ── Write handlers ── */
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setIsLoggingIn(true);
    try {
      await signInWithEmailAndPassword(auth, loginForm.credential.trim(), loginForm.password);
    } catch (err) {
      console.error('Admin login failed', err);
      setAuthError(getAdminLoginErrorMessage(err));
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleLogout() {
    await signOut(auth);
    setIdentity(null);
  }

  async function handlePasswordReset() {
    const email = loginForm.credential.trim();
    setAuthError('');

    if (!email || !email.includes('@')) {
      setAuthError('Masukkan email admin dulu, lalu tekan Forgot password lagi.');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      setAuthError(`Link reset password sudah dikirim ke ${email}. Cek inbox atau spam.`);
    } catch (err) {
      console.error('Password reset failed', err);
      setAuthError('Tidak bisa mengirim reset password. Pastikan email admin benar dan terdaftar di Firebase Auth.');
    }
  }

  function showDashboardNotice(message: string) {
    setNotificationMessage(message);
  }

  function openAdminTab(tab: AdminTab) {
    setActiveTab(tab);
    setShellSearch('');
  }

  function handleSupportConcierge() {
    showDashboardNotice('Support Concierge ready. Escalate hotel operations issues through the duty manager channel.');
  }

  function handleNotificationCenter() {
    if (unreadIncomingOrders.length > 0) {
      openAdminTab('orders');
      setOrderQueueView('active');
      setOrdersAttentionOnly(true);
      showDashboardNotice(`${unreadIncomingOrders.length} unread incoming order${unreadIncomingOrders.length === 1 ? '' : 's'} shown in the priority queue.`);
      return;
    }
    showDashboardNotice('No unread incoming orders right now.');
  }

  async function updateOrderStatusDocument(orderId: string, status: string): Promise<void> {
    const updatedAt = new Date();
    try {
      await withTimeout(
        updateDoc(doc(db, 'orders', orderId), { status, isRead: true, updatedAt: serverTimestamp() }),
        'order-status-timeout',
      );
      return;
    } catch (sdkError) {
      console.warn('Firebase SDK order status update failed, trying REST fallback.', sdkError);
    }

    await patchFirestoreDocument('orders', orderId, { status, isRead: true, updatedAt });
  }

  async function createShiftNoteDocument(note: Omit<ShiftNote, 'id' | 'createdAt'>): Promise<ShiftNote> {
    const createdAt = new Date();
    const payload = {
      ...note,
      createdAt,
    };

    try {
      const id = await createFirestoreDocument('shiftNotes', payload);
      return { id, ...note, createdAt };
    } catch (restError) {
      console.warn('REST handover save failed, trying Firebase SDK.', restError);
    }

    const ref = await withTimeout(
      addDoc(collection(db, 'shiftNotes'), { ...note, createdAt: serverTimestamp() }),
      'shift-note-timeout',
    );
    return { id: ref.id, ...note, createdAt };
  }

  function handleProfileShortcut() {
    openAdminTab('settings');
    showDashboardNotice('Opened operator settings.');
  }

  function toggleOrderPriorityFilter() {
    setOrderQueueView('active');
    setOrdersAttentionOnly((current) => {
      const next = !current;
      showDashboardNotice(next ? 'Showing incoming, unread, and delayed orders only.' : 'Showing all active orders.');
      return next;
    });
  }

  function toggleOrderIntake() {
    setIsOrderIntakePaused((current) => {
      const next = !current;
      showDashboardNotice(next ? 'New order intake paused locally for this dashboard session.' : 'New order intake resumed locally for this dashboard session.');
      return next;
    });
  }

  async function clearOldOrders() {
    if (!hasManagerAccess('clear old orders')) return;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const stale = orders.filter((o) => isTerminalStatus(o.status) && o.createdAt && o.createdAt < startOfToday);
    if (stale.length === 0) {
      showDashboardNotice('No completed orders from previous days to clear.');
      return;
    }
    setConfirmDialog({
      title: 'Clear Old Orders',
      message: `Delete ${stale.length} completed order(s) from previous days? This cannot be undone.`,
      onConfirm: async () => {
        for (const o of stale) { await deleteDoc(doc(db, 'orders', o.id)); }
        await logAudit('clear_old_orders', 'order', 'batch', { count: stale.length });
        showDashboardNotice(`${stale.length} old order(s) cleared.`);
      },
    });
  }

  function handleMessageGuest(order: DashboardOrder) {
    if (order.phoneNumber) {
      window.location.href = `sms:${order.phoneNumber}`;
    }
    showDashboardNotice(
      order.phoneNumber
        ? `Opening message composer for Suite ${order.roomNumber}. Contact: ${order.phoneNumber}`
        : `No phone number is attached to Suite ${order.roomNumber}. Use hotel PMS contact lookup.`,
    );
  }

  async function acknowledgeFeedback(order: DashboardOrder) {
    await markAsRead(order.id);
    showDashboardNotice(`Feedback from Suite ${order.roomNumber} acknowledged.`);
  }

  function replyToFeedback(order: DashboardOrder) {
    showDashboardNotice(`Reply workflow prepared for Suite ${order.roomNumber}. Use guest contact details from the order record.`);
  }

  async function resolveFeedback(order: DashboardOrder) {
    if (!identity) return;
    setBusyActionId(`resolve-${order.id}`);
    try {
      await updateDoc(doc(db, 'orders', order.id), {
        isRead: true,
        feedbackDetails: deleteField(),
        feedback: deleteField(),
        reviewSummary: deleteField(),
        rating: deleteField(),
        requestManagerFollowUp: deleteField(),
        updatedAt: serverTimestamp(),
      });
      setOrders((rows) => rows.map((item) => (
        item.id === order.id
          ? { ...item, isRead: true, feedbackText: '', feedbackSummary: '', rating: null, managerFollowUpRequested: false }
          : item
      )));
      await logAudit('resolve_feedback', 'order', order.id, { room: order.roomNumber });
      showDashboardNotice(`Feedback from Suite ${order.roomNumber} resolved and cleared.`);
    } catch (err) {
      console.error('Failed to resolve feedback', err);
      showDashboardNotice('Could not resolve feedback. Check Firebase permissions.');
    } finally {
      setBusyActionId(null);
    }
  }

  async function clearAllResolvedFeedback() {
    if (!hasManagerAccess('clear resolved feedback')) return;
    const resolved = feedbackOrders.filter((o) => o.isRead);
    if (resolved.length === 0) {
      showDashboardNotice('No resolved feedback to clear.');
      return;
    }
    setConfirmDialog({
      title: 'Clear Resolved Feedback',
      message: `Clear feedback from ${resolved.length} resolved order(s)? The orders themselves are kept.`,
      onConfirm: async () => {
        for (const o of resolved) {
          await updateDoc(doc(db, 'orders', o.id), {
            feedbackDetails: deleteField(),
            feedback: deleteField(),
            reviewSummary: deleteField(),
            rating: deleteField(),
            requestManagerFollowUp: deleteField(),
            updatedAt: serverTimestamp(),
          });
        }
        await logAudit('clear_resolved_feedback', 'order', 'batch', { count: resolved.length });
        showDashboardNotice(`${resolved.length} resolved feedback record(s) cleared.`);
      },
    });
  }

  function deleteFeedback(order: DashboardOrder) {
    if (!hasManagerAccess('delete feedback')) return;
    setConfirmDialog({
      title: 'Delete Feedback',
      message: `Delete feedback from Suite ${order.roomNumber}?`,
      detail: 'This clears the rating, written feedback, summary, and follow-up flag from the order while keeping the order record itself.',
      confirmLabel: 'Delete Feedback',
      icon: 'reviews',
      onConfirm: () => executeDeleteFeedback(order.id),
    });
  }

  async function executeDeleteFeedback(orderId: string) {
    if (!hasManagerAccess('delete feedback')) return;
    const order = orders.find((item) => item.id === orderId);
    setBusyActionId(`delete-feedback-${orderId}`);
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        feedbackDetails: deleteField(),
        feedback: deleteField(),
        reviewSummary: deleteField(),
        rating: deleteField(),
        requestManagerFollowUp: deleteField(),
        updatedAt: serverTimestamp(),
      });
      setOrders((rows) => rows.map((item) => (
        item.id === orderId
          ? { ...item, feedbackText: '', feedbackSummary: '', rating: null, managerFollowUpRequested: false }
          : item
      )));
      await logAudit('delete_feedback', 'order', orderId, { roomNumber: order?.roomNumber });
      showDashboardNotice(`Feedback from Suite ${order?.roomNumber || 'order'} deleted.`);
    } catch (err) {
      console.error('Failed to delete feedback', err);
      showDashboardNotice('Could not delete feedback. Check Firebase permission or connection.');
    } finally {
      setBusyActionId(null);
    }
  }

  async function saveSettingsDraft() {
    if (!identity) return;
    const settingsId = hotelId.trim() || identity.hotelId || identity.uid;
    setIsSavingSettings(true);
    try {
      await setDoc(doc(db, 'adminSettings', settingsId), {
        hotelId: hotelId.trim(),
        operatingHours,
        taxRate: Number(taxRate) || 0,
        surchargeRate: Number(surchargeRate) || 0,
        alertPreferences,
        updatedAt: serverTimestamp(),
        updatedBy: identity.uid,
      }, { merge: true });
      await logAudit('save_admin_settings', 'settings', settingsId, { hotelId: hotelId.trim() });
      showDashboardNotice('Settings saved to Firebase.');
    } catch (err) {
      console.error('Failed to save settings', err);
      showDashboardNotice('Could not save settings. Check Firebase permission or connection.');
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function updateOrderStatus(orderId: string, status: string) {
    const current = orders.find((o) => o.id === orderId);
    if (!current) return;
    const prev = current.status;
    setBusyActionId(`status-${orderId}`);
    setOrders((rows) => rows.map((order) => (
      order.id === orderId ? { ...order, status, isRead: true } : order
    )));
    try {
      await updateOrderStatusDocument(orderId, status);
      await logAudit('status_change', 'order', orderId, { from: prev, to: status });
      showDashboardNotice(`Suite ${current.roomNumber} moved to ${formatStatusLabel(status)}.`);
    } catch (err) {
      console.error('Failed to update order status', err);
      setOrders((rows) => rows.map((order) => (
        order.id === orderId ? { ...order, status: prev, isRead: current.isRead } : order
      )));
      showDashboardNotice(`Could not update Suite ${current.roomNumber}. Check Firebase permission or connection.`);
    } finally {
      setBusyActionId(null);
    }
  }

  async function markAsRead(orderId: string) {
    const current = orders.find((o) => o.id === orderId);
    setBusyActionId(`read-${orderId}`);
    setOrders((rows) => rows.map((order) => (
      order.id === orderId ? { ...order, isRead: true } : order
    )));
    try {
      await updateDoc(doc(db, 'orders', orderId), { isRead: true, updatedAt: serverTimestamp() });
      await logAudit('mark_read', 'order', orderId);
    } catch (err) {
      console.error('Failed to mark order as read', err);
      if (current) {
        setOrders((rows) => rows.map((order) => (
          order.id === orderId ? { ...order, isRead: current.isRead } : order
        )));
      }
      showDashboardNotice('Could not update read state. Check Firebase permission or connection.');
    } finally {
      setBusyActionId(null);
    }
  }

  function deleteOrder(order: DashboardOrder) {
    if (!hasManagerAccess('delete orders')) return;
    setConfirmDialog({
      title: 'Delete Order',
      message: `Delete Suite ${order.roomNumber} order from Live Orders?`,
      detail: 'This removes the order document from the dashboard and revenue calculations. Use Revoke Access when the guest session also needs to be blocked.',
      confirmLabel: 'Delete Order',
      icon: 'delete',
      onConfirm: () => executeDeleteOrder(order.id),
    });
  }

  async function executeDeleteOrder(orderId: string) {
    if (!hasManagerAccess('delete orders')) return;
    const order = orders.find((item) => item.id === orderId);
    setBusyActionId(`delete-order-${orderId}`);
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      hideOrderLocally(orderId);
      setOrders((currentRows) => currentRows.filter((item) => item.id !== orderId));
      await logAudit('delete_order', 'order', orderId, { roomNumber: order?.roomNumber, status: order?.status });
      showDashboardNotice(`Suite ${order?.roomNumber || 'order'} deleted.`);
    } catch (err) {
      console.error('Failed to delete order', err);
      try {
        await updateOrderStatusDocument(orderId, 'cancelled');
      } catch (cancelErr) {
        console.warn('Delete fallback cancel failed; hiding order locally.', cancelErr);
      }
      hideOrderLocally(orderId);
      setOrders((currentRows) => currentRows.map((item) => (
        item.id === orderId ? { ...item, status: 'cancelled', isRead: true } : item
      )));
      showDashboardNotice(`Suite ${order?.roomNumber || 'order'} removed from this dashboard. Deploy Firestore rules to allow hard delete.`);
    } finally {
      setBusyActionId(null);
    }
  }

  async function toggleProductAvailability(product: MenuProduct) {
    const next = !product.isAvailable;
    const updatedProduct = {
      ...product,
      isAvailable: next,
      unavailableReason: next ? '' : (product.unavailableReason || 'Temporarily unavailable'),
    };
    setBusyActionId(`product-${product.id}`);
    setProducts((rows) => rows.map((item) => item.id === product.id ? updatedProduct : item));
    try {
      if (product.id.startsWith('local-product-')) {
        upsertLocalProduct(updatedProduct);
      } else {
        await withTimeout(updateDoc(doc(db, 'products', product.id), {
          isAvailable: next,
          unavailableReason: updatedProduct.unavailableReason,
          updatedAt: serverTimestamp(),
        }), 'product-toggle-timeout');
        upsertLocalProduct(updatedProduct);
        await logAudit(next ? 'set_available' : 'set_unavailable', 'product', product.id, { name: product.name });
      }
      showDashboardNotice(`${product.name} is now ${next ? 'available' : 'offline'}.`);
    } catch (err) {
      console.error('Failed to update product availability', err);
      upsertLocalProduct(updatedProduct);
      showDashboardNotice(`${product.name} updated on this dashboard. Deploy Firestore rules to sync availability.`);
    } finally {
      setBusyActionId(null);
    }
  }

  async function handleMenuImageUpload(file: File | undefined) {
    if (!file || !editingProduct) return;
    if (!file.type.startsWith('image/')) {
      showDashboardNotice('Please upload an image file for the menu item.');
      return;
    }
    if (file.size > 3_000_000) {
      showDashboardNotice('Image is too large. Use an image under 3 MB.');
      return;
    }

    const editorId = editingProduct.id;
    setIsProcessingMenuImage(true);
    try {
      const image = await prepareMenuImage(file);
      setEditingProduct((current) => {
        if (!current || current.id !== editorId) return current;
        return { ...current, image };
      });
      showDashboardNotice('Image uploaded into the menu editor.');
    } catch (err) {
      console.error('Failed to upload menu image', err);
      showDashboardNotice('Could not read the selected image.');
    } finally {
      setIsProcessingMenuImage(false);
    }
  }

  async function handleNativeMenuImageUpload(): Promise<boolean> {
    if (!editingProduct) return false;
    const editorId = editingProduct.id;
    setIsProcessingMenuImage(true);

    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Photos,
        resultType: CameraResultType.DataUrl,
        quality: 82,
        width: 1280,
        allowEditing: false,
      });
      if (!photo.dataUrl) throw new Error('native-image-empty');
      const image = await prepareMenuImageDataUrl(photo.dataUrl);
      setEditingProduct((current) => {
        if (!current || current.id !== editorId) return current;
        return { ...current, image };
      });
      showDashboardNotice('Image selected from iPad Photos.');
      return true;
    } catch (err) {
      console.warn('Native menu image picker failed', err);
      if (isPickerCancellation(err)) return true;
      showDashboardNotice('iPad photo picker unavailable. Opening file picker fallback.');
      return false;
    } finally {
      setIsProcessingMenuImage(false);
    }
  }

  async function openMenuImagePicker() {
    if (isProcessingMenuImage) return;
    if (Capacitor.isNativePlatform()) {
      const didPickNativeImage = await handleNativeMenuImageUpload();
      if (didPickNativeImage) return;
    }
    menuImageInputRef.current?.click();
  }

  async function saveProduct(editor: MenuEditorState) {
    const name = editor.name.trim();
    const category = editor.category.trim() || 'Mains';
    const numericPrice = Number(editor.price);

    if (!name) {
      showDashboardNotice('Menu item name is required.');
      return;
    }
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      showDashboardNotice('Use a valid menu price before saving.');
      return;
    }

    setIsSavingProduct(true);
    const updatedAt = new Date();
    const payload = {
      name, category,
      price: numericPrice, description: editor.description.trim(),
      image: editor.image.trim(), isAvailable: editor.isAvailable,
      unavailableReason: editor.unavailableReason.trim(), updatedAt: serverTimestamp(),
    };
    const localId = editor.id || `local-product-${Date.now()}`;
    const savedProduct: MenuProduct = {
      id: localId,
      sourceItemId: undefined,
      name,
      category,
      price: numericPrice,
      image: editor.image.trim(),
      description: editor.description.trim(),
      isAvailable: editor.isAvailable,
      unavailableReason: editor.unavailableReason.trim(),
    };
    try {
      if (editor.id?.startsWith('local-product-')) {
        setProducts((rows) => rows.map((item) => item.id === editor.id ? { ...savedProduct, id: editor.id as string } : item));
        upsertLocalProduct({ ...savedProduct, id: editor.id });
        showDashboardNotice(`${name} updated on this dashboard.`);
      } else if (editor.id) {
        await withTimeout(updateDoc(doc(db, 'products', editor.id), payload), 'save-menu-timeout');
        setProducts((rows) => rows.map((item) => item.id === editor.id ? { ...savedProduct, id: editor.id as string } : item));
        upsertLocalProduct({ ...savedProduct, id: editor.id });
        await logAudit('edit_product', 'product', editor.id, { name, updatedAt: updatedAt.toISOString() });
        showDashboardNotice(`${name} updated in Menu Manager.`);
      } else {
        const ref = await withTimeout(addDoc(collection(db, 'products'), { ...payload, createdAt: serverTimestamp() }), 'save-menu-timeout');
        setProducts((rows) => [{ ...savedProduct, id: ref.id }, ...rows]);
        upsertLocalProduct({ ...savedProduct, id: ref.id });
        await logAudit('add_product', 'product', ref.id, { name, updatedAt: updatedAt.toISOString() });
        showDashboardNotice(`${name} added to Menu Manager.`);
      }
      setEditingProduct(null);
    } catch (err) {
      console.error('Failed to save menu item', err);
      upsertLocalProduct(savedProduct);
      setProducts((rows) => [savedProduct, ...rows.filter((item) => item.id !== savedProduct.id)]);
      setEditingProduct(null);
      showDashboardNotice(`${name} saved on this dashboard. Deploy Firestore rules to sync it to cloud.`);
    } finally {
      setIsSavingProduct(false);
    }
  }

  function deleteProduct(productId: string) {
    if (!hasManagerAccess('remove menu items')) return;
    const product = products.find((p) => p.id === productId);
    setConfirmDialog({
      title: 'Remove Menu Item',
      message: `Remove ${product?.name || 'this menu item'} from Menu Manager? This action cannot be undone.`,
      detail: 'Only manager accounts can delete menu data. Staff can still edit availability when permitted.',
      confirmLabel: 'Remove Item',
      icon: 'delete',
      onConfirm: () => executeDeleteProduct(productId),
    });
  }

  async function executeDeleteProduct(productId: string) {
    if (!hasManagerAccess('remove menu items')) return;
    const product = products.find((p) => p.id === productId);
    setBusyActionId(`delete-product-${productId}`);
    try {
      await deleteDoc(doc(db, 'products', productId));
      removeLocalProduct(productId);
      setProducts((rows) => rows.filter((item) => item.id !== productId));
      await logAudit('delete_product', 'product', productId, { name: product?.name });
      showDashboardNotice(`${product?.name || 'Menu item'} removed from Menu Manager.`);
    } catch (err) {
      console.error('Failed to delete product', err);
      if (productId.startsWith('local-product-')) {
        removeLocalProduct(productId);
        setProducts((rows) => rows.filter((item) => item.id !== productId));
        showDashboardNotice(`${product?.name || 'Menu item'} removed from this dashboard.`);
      } else {
        showDashboardNotice('Could not remove menu item. Check Firebase permission or connection.');
      }
    } finally {
      setBusyActionId(null);
    }
  }

  function handleRevokeOrder(order: DashboardOrder) {
    if (!hasManagerAccess('revoke guest access')) return;
    if (!canRevokeOrderAccess(order)) {
      showDashboardNotice('This order has no active guest session or access token to revoke.');
      return;
    }
    setConfirmDialog({
      title: 'Revoke Order Access',
      message: `Revoke access for Suite ${order.roomNumber}?`,
      detail: 'The guest QR/session token will stop working immediately and this order will be marked cancelled so it no longer stays in the active queue.',
      confirmLabel: 'Revoke Order',
      cancelLabel: 'Keep Active',
      icon: 'block',
      onConfirm: () => executeRevokeOrder(order),
    });
  }

  async function executeRevokeOrder(order: DashboardOrder) {
    if (!hasManagerAccess('revoke guest access')) return;
    if (!canRevokeOrderAccess(order)) return;

    const busyId = `revoke-order-${order.id}`;
    setRevokingSessionId(busyId);
    try {
      await updateDoc(doc(db, 'orders', order.id), {
        status: 'cancelled',
        isRead: true,
        updatedAt: serverTimestamp(),
      });

      const revocationWrites: Promise<unknown>[] = [];

      if (order.guestUid) {
        revocationWrites.push(setDoc(doc(db, 'guest_access_sessions', order.guestUid), {
          status: 'revoked',
          expiresAt: serverTimestamp(),
          revokedAt: serverTimestamp(),
          revokedBy: identity?.uid || 'manager',
        }, { merge: true }));
      }

      if (order.accessTokenId) {
        revocationWrites.push(setDoc(doc(db, 'guest_access_tokens', order.accessTokenId), {
          status: 'revoked',
          expiresAt: serverTimestamp(),
          revokedAt: serverTimestamp(),
          revokedBy: identity?.uid || 'manager',
        }, { merge: true }));
      }

      const revocationResults = await Promise.allSettled(revocationWrites);
      const failedRevocationWrites = revocationResults.filter((result) => result.status === 'rejected');
      setOrders((rows) => rows.map((item) => (
        item.id === order.id ? { ...item, status: 'cancelled', isRead: true } : item
      )));
      await logAudit('revoke_order_access', 'order', order.id, {
        guestUid: order.guestUid || null,
        accessTokenId: order.accessTokenId || null,
        sessionWritesBlocked: failedRevocationWrites.length > 0,
      });
      showDashboardNotice(
        failedRevocationWrites.length > 0
          ? `Suite ${order.roomNumber} cancelled. Deploy updated Firestore rules to block the guest token/session too.`
          : `Suite ${order.roomNumber} revoked and removed from the active queue.`,
      );
    } catch (err) {
      console.error('Failed to revoke order access', err);
      showDashboardNotice('Could not revoke this order. Check Firebase permission or connection.');
    } finally {
      setRevokingSessionId(null);
    }
  }

  async function exportRevenue() {
    const exp = buildRevenueExport(revenueSummary.rows, new Date(`${selectedDate}T12:00:00`));
    downloadExcelFile(exp.filename, exp.mimeType, exp.content);
    try {
      await navigator.clipboard.writeText(exp.content);
      showDashboardNotice(`${exp.filename} prepared. Report content was also copied to clipboard for iPad fallback.`);
    } catch {
      showDashboardNotice(`${exp.filename} prepared. If iPad does not show a Files prompt, run export from desktop Safari.`);
    }
  }

  async function saveHandoverNote() {
    if (!handoverDraft.trim() || !identity) return;
    setIsSavingNote(true);
    const noteInput = {
      shift: activeShift,
      note: handoverDraft.trim(),
      authorName: identity.name,
      authorUid: identity.uid,
    };
    try {
      const savedNote = await createShiftNoteDocument(noteInput);
      await logAudit('add_shift_note', 'shiftNote', savedNote.id, { shift: activeShift });
      setHandoverDraft('');
      setShiftNotes((current) => mergeShiftNotes([savedNote, ...current]));
      showDashboardNotice(`Handover note posted to ${activeShift} shift.`);
    } catch (err) {
      console.error('Failed to save handover note to cloud, saving locally', err);
      const localNote: ShiftNote = {
        id: `local-${Date.now()}`,
        ...noteInput,
        createdAt: new Date(),
      };
      persistLocalShiftNote(localNote);
      setShiftNotes((current) => mergeShiftNotes([localNote, ...current]));
      setHandoverDraft('');
      showDashboardNotice('Handover note saved on this dashboard. Cloud sync is unavailable.');
    } finally {
      setIsSavingNote(false);
    }
  }

  function deleteShiftNote(note: ShiftNote) {
    if (!hasManagerAccess('delete handover notes')) return;
    setConfirmDialog({
      title: 'Delete Handover Note',
      message: `Delete ${note.shift} shift note from ${note.authorName || 'operator'}?`,
      detail: 'This removes the note from the handover board. Local fallback notes are removed from this device only.',
      confirmLabel: 'Delete Note',
      icon: 'delete',
      onConfirm: () => executeDeleteShiftNote(note),
    });
  }

  async function executeDeleteShiftNote(note: ShiftNote) {
    if (!hasManagerAccess('delete handover notes')) return;
    setBusyActionId(`delete-note-${note.id}`);
    try {
      if (note.id.startsWith('local-')) {
        const nextLocalNotes = loadLocalShiftNotes().filter((item) => item.id !== note.id);
        window.localStorage.setItem(LOCAL_SHIFT_NOTES_KEY, JSON.stringify(nextLocalNotes.map((item) => ({
          ...item,
          createdAt: item.createdAt ? item.createdAt.toISOString() : null,
        }))));
      } else {
        await deleteDoc(doc(db, 'shiftNotes', note.id));
      }

      setShiftNotes((rows) => rows.filter((item) => item.id !== note.id));
      await logAudit('delete_shift_note', 'shiftNote', note.id, { shift: note.shift });
      showDashboardNotice('Handover note deleted.');
    } catch (err) {
      console.error('Failed to delete handover note', err);
      showDashboardNotice('Could not delete handover note. Check Firebase permission or connection.');
    } finally {
      setBusyActionId(null);
    }
  }

  async function saveStaffAccount(editor: StaffEditorState) {
    if (!identity) return;
    if (!hotelId.trim()) {
      setTeamStatus('Hotel ID is required before creating or updating staff access.');
      return;
    }
    setIsSavingStaff(true);
    setTeamStatus('');
    try {
      if (editor.uid) {
        await updateAdminProfile({
          uid: editor.uid,
          name: editor.name.trim(),
          username: editor.username.trim(),
          role: editor.role,
          active: editor.active,
        });
        if (editor.password.trim()) {
          await updateAdminPassword({ uid: editor.uid, newPassword: editor.password.trim() });
        }
        await logAudit('update_admin_user', 'guestSession', editor.uid, { role: editor.role, active: editor.active });
        setTeamStatus('Staff access updated.');
      } else {
        await createAdminUser({
          email: editor.email.trim(),
          password: editor.password.trim(),
          name: editor.name.trim(),
          username: editor.username.trim(),
          role: editor.role,
          hotelId,
          active: editor.active,
        });
        await logAudit('create_admin_user', 'guestSession', editor.email.trim(), { role: editor.role });
        setTeamStatus('Staff account created.');
      }
      setStaffEditor(null);
    } catch (err) {
      console.error('Failed to save staff account', err);
      setTeamStatus('Failed to save staff account. Verify callable functions are deployed.');
    } finally {
      setIsSavingStaff(false);
    }
  }

  function removeStaffAccount(uid: string) {
    if (!hasManagerAccess('remove staff accounts')) return;
    const staff = staffAccounts.find((account) => account.uid === uid);
    setConfirmDialog({
      title: 'Remove Staff Account',
      message: `Remove ${staff?.name || 'this staff account'} from admin access? This action cannot be undone.`,
      detail: 'This removes dashboard access for the selected operator. Existing audit logs are kept.',
      confirmLabel: 'Remove Staff',
      icon: 'person_remove',
      onConfirm: () => executeRemoveStaffAccount(uid),
    });
  }

  async function executeRemoveStaffAccount(uid: string) {
    if (!hasManagerAccess('remove staff accounts')) return;
    setTeamStatus('');
    try {
      await deleteAdminUser(uid);
      await logAudit('delete_admin_user', 'guestSession', uid);
      setTeamStatus('Staff account removed.');
    } catch (err) {
      console.error('Failed to delete staff account', err);
      setTeamStatus('Failed to remove staff account. Verify callable functions are deployed.');
    }
  }

  async function resetStaffPassword(uid: string, nextPassword: string) {
    setPasswordResetUid(uid);
    setTeamStatus('');
    try {
      await updateAdminPassword({ uid, newPassword: nextPassword });
      await logAudit('reset_admin_password', 'guestSession', uid);
      setTeamStatus('Password updated.');
      setStaffEditor(null);
    } catch (err) {
      console.error('Failed to update password', err);
      setTeamStatus('Failed to update password. Verify callable functions are deployed.');
    } finally {
      setPasswordResetUid(null);
    }
  }

  /* ─────────────────── RENDER ─────────────────── */

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#faf9f7] text-[#1a1c1b] flex items-center justify-center" style={{ fontFamily: "'Manrope', sans-serif" }}>
        <div className="rounded-lg bg-white px-8 py-7 shadow-[0_20px_40px_rgba(26,28,27,0.06)]">
          <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.22em] text-[#775a19]">Atelier Meridian</p>
          <h1 className="mt-2 font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Preparing Admin Dashboard</h1>
          <p className="mt-2 font-['Manrope'] text-sm text-[#5f5e5e]">Checking operator session...</p>
        </div>
      </div>
    );
  }

  /* ── Login ── */
  if (!identity) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          overflow: 'hidden',
          background: '#0d0c0b',
          fontFamily: "'Manrope', sans-serif",
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {/* Background image */}
        <img
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuCWL_a1MEzQsNxi6caSoxN25GePda4Y-AYSVFBiUFV5gCQNr4-P7sUPPyV6OfoO4LqjRAR5UhmqIonXT6r5T9HvyKWfm9tlMqNFwP62Dcuyhtd0cg-9Uxbcqae6CApk4TzWi_zOiC0r_hCRhGIlATcTgmU6b_mQbLL1UDRghfD97jmHEIh8_1PRHsCO7_dG8MWgemMGuAXxm16SMsMxYMvrZGasddrV9xLRqzji141r_YuR7bpE_m8vfinbz2gOHZxaNJduhNJFlw"
          alt=""
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
        />
        {/* Gradient overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.85) 100%)',
          }}
        />

        {/* Content column */}
        <div
          style={{
            position: 'relative',
            zIndex: 10,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            maxWidth: '28rem',
            marginInline: 'auto',
            width: '100%',
          }}
        >
          {/* Top branding */}
          <header
            style={{
              paddingTop: 'calc(env(safe-area-inset-top) + 2.5rem)',
              paddingLeft: '2rem',
              paddingRight: '2rem',
              textAlign: 'center',
            }}
          >
            <p
              style={{
                margin: '0 0 0.6rem',
                fontSize: '9px',
                textTransform: 'uppercase',
                letterSpacing: '0.34em',
                color: 'rgba(255,255,255,0.72)',
              }}
            >
              Staff Portal
            </p>
            <h1
              style={{
                margin: 0,
                fontFamily: "'Noto Serif', serif",
                fontSize: '2.2rem',
                fontWeight: 400,
                fontStyle: 'italic',
                lineHeight: 1,
                letterSpacing: '0.04em',
                color: '#ffffff',
                textShadow: '0 6px 24px rgba(0,0,0,0.22)',
              }}
            >
              Atelier Meridian
            </h1>
          </header>

          {/* Flexible spacer */}
          <div style={{ flex: 1 }} />

          {/* Liquid glass card — anchored to bottom */}
          <div
            style={{
              marginLeft: '1rem',
              marginRight: '1rem',
              marginBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)',
              borderRadius: '2rem',
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'linear-gradient(145deg, rgba(34,27,22,0.55), rgba(255,255,255,0.08))',
              backdropFilter: 'blur(34px)',
              WebkitBackdropFilter: 'blur(34px)',
              boxShadow: '0 28px 70px rgba(8,7,7,0.45)',
              paddingTop: '1.75rem',
              paddingBottom: '1.5rem',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {/* Glass sheen layers */}
            <div aria-hidden="true" style={{ pointerEvents: 'none', position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.02) 42%, rgba(255,255,255,0.12) 100%)' }} />
            <div aria-hidden="true" style={{ pointerEvents: 'none', position: 'absolute', right: '-2.5rem', top: '0.5rem', width: '8rem', height: '8rem', borderRadius: '9999px', background: 'rgba(255,255,255,0.08)', filter: 'blur(48px)' }} />
            <div aria-hidden="true" style={{ pointerEvents: 'none', position: 'absolute', left: '-2rem', bottom: '4rem', width: '6rem', height: '6rem', borderRadius: '9999px', background: 'rgba(255,255,255,0.06)', filter: 'blur(40px)' }} />
            {/* Top highlight line */}
            <div aria-hidden="true" style={{ pointerEvents: 'none', position: 'absolute', top: 0, left: '1.25rem', right: '1.25rem', height: '1px', background: 'rgba(255,255,255,0.38)' }} />
            {/* Inner border */}
            <div aria-hidden="true" style={{ pointerEvents: 'none', position: 'absolute', inset: '1px', borderRadius: 'calc(2rem - 1px)', border: '1px solid rgba(255,255,255,0.07)' }} />

            {/* Card content */}
            <div style={{ position: 'relative', paddingLeft: '1.75rem', paddingRight: '1.75rem' }}>

              {/* Card heading */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h2
                  style={{
                    margin: '0 0 0.4rem',
                    fontFamily: "'Noto Serif', serif",
                    fontSize: '1.7rem',
                    fontWeight: 400,
                    lineHeight: 1.1,
                    color: '#ffffff',
                  }}
                >
                  Sign in
                </h2>
                <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.6, color: 'rgba(255,255,255,0.65)' }}>
                  In-Room Dining Dashboard
                </p>
              </div>

              {/* Form */}
              <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }} onSubmit={handleLogin}>

                {/* Staff ID / Email */}
                <div
                  style={{
                    borderRadius: '1.1rem',
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.08)',
                    padding: '0.7rem 1rem',
                    transition: 'border-color 0.2s, background 0.2s',
                  }}
                >
                  <label
                    htmlFor="credential"
                    style={{ display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.18em', color: 'rgba(255,255,255,0.62)', marginBottom: '0.2rem' }}
                  >
                    Staff ID / Email
                  </label>
                  <input
                    id="credential"
                    type="text"
                    autoComplete="username"
                    value={loginForm.credential}
                    onChange={(e) => setLoginForm((c) => ({ ...c, credential: e.target.value }))}
                    style={{ display: 'block', width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: '15px', fontWeight: 500, color: '#ffffff', padding: 0, lineHeight: 1.4, boxSizing: 'border-box' }}
                  />
                </div>

                {/* Password */}
                <div
                  style={{
                    position: 'relative',
                    borderRadius: '1.1rem',
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.08)',
                    padding: '0.7rem 1rem',
                    transition: 'border-color 0.2s, background 0.2s',
                  }}
                >
                  <label
                    htmlFor="password"
                    style={{ display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.18em', color: 'rgba(255,255,255,0.62)', marginBottom: '0.2rem' }}
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm((c) => ({ ...c, password: e.target.value }))}
                    style={{ display: 'block', width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: '15px', fontWeight: 500, color: '#ffffff', padding: 0, paddingRight: '2rem', lineHeight: 1.4, boxSizing: 'border-box' }}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: '0.875rem', bottom: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgba(255,255,255,0.55)' }}
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>

                {/* Remember me + Forgot password */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
                    <div style={{ position: 'relative', width: '18px', height: '18px', flexShrink: 0 }}>
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        style={{ appearance: 'none', WebkitAppearance: 'none', width: '18px', height: '18px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.3)', background: rememberMe ? '#9a7416' : 'rgba(255,255,255,0.08)', cursor: 'pointer', transition: 'background 0.2s, border-color 0.2s' }}
                      />
                      {rememberMe && (
                        <svg style={{ position: 'absolute', top: '3px', left: '3px', pointerEvents: 'none' }} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="2 6 5 9 10 3" />
                        </svg>
                      )}
                    </div>
                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.65)' }}>Remember me</span>
                  </label>
                  <button
                    type="button"
                    onClick={handlePasswordReset}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'rgba(255,255,255,0.65)', textDecoration: 'underline', textUnderlineOffset: '3px', padding: 0 }}
                  >
                    Forgot password?
                  </button>
                </div>

                {/* Error */}
                {authError ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', borderRadius: '0.75rem', background: 'rgba(255,218,214,0.15)', border: '1px solid rgba(186,26,26,0.4)', padding: '0.75rem 1rem' }}>
                    <svg style={{ width: '14px', height: '14px', color: '#ffb4ab', flexShrink: 0, marginTop: '1px' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <p style={{ margin: 0, fontSize: '12px', color: '#ffb4ab', lineHeight: 1.5 }}>{authError}</p>
                  </div>
                ) : null}

                {/* Submit */}
                <div style={{ paddingTop: '0.5rem' }}>
                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.75rem',
                      width: '100%',
                      height: '56px',
                      borderRadius: '1rem',
                      border: 'none',
                      backgroundColor: '#9a7416',
                      color: '#ffffff',
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.18em',
                      boxShadow: '0 18px 34px rgba(119,90,25,0.3), inset 0 1px 0 rgba(255,255,255,0.22)',
                      cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                      opacity: isLoggingIn ? 0.6 : 1,
                      transition: 'opacity 0.15s, transform 0.15s',
                      WebkitAppearance: 'none',
                      appearance: 'none',
                    }}
                  >
                    <span>{isLoggingIn ? 'Signing in…' : 'Access Dashboard'}</span>
                    {!isLoggingIn && (
                      <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '1.5rem', height: '1.5rem', borderRadius: '9999px', background: 'rgba(255,255,255,0.14)', fontSize: '13px', lineHeight: 1 }}>→</span>
                    )}
                  </button>
                </div>
              </form>

              {/* Footer links inside card */}
              <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)' }}>
                <span>© {new Date().getFullYear()} Atelier Meridian</span>
                <div style={{ display: 'flex', gap: '1.25rem' }}>
                  {['Privacy', 'Support'].map((link) => (
                    <button
                      key={link}
                      type="button"
                      onClick={() => setAuthError(link === 'Privacy' ? 'Privacy policy is managed by the hotel operations team.' : 'Support requests are handled by the duty manager.')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', padding: 0 }}
                    >
                      {link}
                    </button>
                  ))}
                </div>
              </div>

            </div>{/* /card content */}
          </div>{/* /glass card */}
        </div>{/* /content column */}

        {/* Grain texture overlay */}
        <div
          aria-hidden="true"
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            inset: 0,
            zIndex: 100,
            opacity: 0.03,
            mixBlendMode: 'overlay',
            backgroundImage: "url('https://www.transparenttextures.com/patterns/natural-paper.png')",
          }}
        />
      </div>
    );
  }

  /* ── Dashboard ── */
  return (
    <div className="admin-dashboard min-h-screen bg-[#faf9f7] text-[#1a1c1b] flex" style={{ fontFamily: "'Manrope', sans-serif" }}>

        {/* ── Sidebar ── */}
        <aside className="admin-sidebar hidden md:flex fixed left-0 top-0 h-full w-64 flex-col bg-stone-100 py-10 z-50">
          <div className="px-8 mb-12">
            <h1 className="font-['Noto_Serif'] text-lg font-bold text-amber-900">Atelier Meridian</h1>
            <p className="mt-1 font-['Manrope'] font-medium text-sm tracking-wide text-stone-500">In-Room Dining Admin</p>
          </div>

          <nav className="flex-1 overflow-y-auto">
            <ul className="space-y-2">
              {navItems.map(({ id, label, icon, badge }) => {
                const isActive = activeTab === id;
                return (
                  <li key={id}>
                    <button
                      className={`relative flex w-full items-center justify-between py-4 pl-8 pr-5 text-left transition-all duration-200 font-['Manrope'] text-sm font-medium tracking-wide ${
                        isActive
                          ? 'bg-white text-amber-900 font-bold'
                          : 'text-stone-600 hover:bg-white/50'
                      }`}
                      onClick={() => openAdminTab(id)}
                      type="button"
                      >
                      <span className="flex items-center gap-4">
                        <span
                          className="material-symbols-outlined text-[20px]"
                          style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                        >
                          {icon}
                        </span>
                        {label}
                      </span>
                      {isActive ? <span className="absolute right-0 top-0 h-full w-1 bg-amber-900 rounded-l-sm" /> : null}
                      {badge ? (
                        <span className="rounded-full bg-[#ffdad6] text-[#93000a] px-1.5 py-0.5 text-[10px] font-bold">
                          {badge}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="px-8 mt-auto">
            <button
              className="w-full py-3 px-4 rounded border border-[#d1c5b4]/30 text-[#775a19] font-['Manrope'] font-medium text-sm hover:bg-[#f4f3f1] transition-colors flex items-center justify-center gap-2"
              onClick={handleSupportConcierge}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">headset_mic</span>
              Support Concierge
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <main className="admin-main flex-1 md:ml-64 relative min-h-screen">

          {/* Top bar */}
          <header className="admin-topbar fixed top-0 right-0 z-40 bg-stone-50/80 backdrop-blur-md shadow-[0_20px_40px_rgba(26,28,27,0.06)] w-full md:w-[calc(100%-16rem)] px-8 py-6 flex justify-between items-center">
            <div className="flex-1 min-w-0">
              <div className="admin-shell-search relative">
                <span className="admin-shell-search-icon material-symbols-outlined text-[#4e4639] text-[18px]">search</span>
                <input
                  type="search"
                  value={shellSearch}
                  onChange={(e) => setShellSearch(e.target.value)}
                  placeholder={TAB_SEARCH_PLACEHOLDERS[activeTab]}
                  className="w-full bg-[#e9e8e6] font-['Manrope'] text-sm text-[#1a1c1b] outline-none transition-colors placeholder:text-[#4e4639]/50 focus:bg-white focus:shadow-[0_2px_8px_rgba(119,90,25,0.08)]"
                />
                {shellSearch ? (
                  <button
                    aria-label="Clear search"
                    className="admin-shell-search-clear"
                    onClick={() => setShellSearch('')}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[17px]">close</span>
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-6">
              <button className="text-amber-800 hover:text-amber-700 transition-colors duration-300 active:scale-95 transform" onClick={handleNotificationCenter} type="button" aria-label="Open priority notifications">
                <span className="material-symbols-outlined text-[24px]">notifications</span>
              </button>
              <button className="text-amber-800 hover:text-amber-700 transition-colors duration-300 active:scale-95 transform" onClick={handleProfileShortcut} type="button" aria-label="Open operator settings">
                <span className="material-symbols-outlined text-[24px]">account_circle</span>
              </button>
            </div>
          </header>

          <div className="admin-canvas pt-32 px-8 md:px-12 pb-24 max-w-7xl mx-auto">

            <div className="admin-mobile-nav mb-8 md:hidden overflow-x-auto" style={{ maskImage: 'linear-gradient(to right, transparent 0%, black 4%, black 92%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 4%, black 92%, transparent 100%)' }}>
              <div className="inline-flex min-w-max gap-2 rounded-full bg-white/78 p-1.5 shadow-[0_16px_34px_rgba(26,28,27,0.06)] ring-1 ring-[#efe8de]">
                {navItems.map(({ id, label, icon, badge }) => {
                  const isActive = activeTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => openAdminTab(id)}
                      className={`flex items-center gap-2 rounded-full px-4 py-2.5 font-['Manrope'] text-xs font-semibold tracking-wide transition ${
                        isActive ? 'bg-[#1a1c1b] text-white' : 'text-[#4e4639]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}>
                        {icon}
                      </span>
                      <span>{label}</span>
                      {badge ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? 'bg-white/16 text-white' : 'bg-[#ffdad6] text-[#93000a]'}`}>{badge}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notification banner */}
            {notificationMessage ? (
              <div className="admin-notification-bar mb-8 flex items-center justify-between rounded-[18px] bg-[#1a1c1b] px-5 py-3 shadow-[0_18px_36px_rgba(26,28,27,0.12)]">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[#c5a059] text-[20px] shrink-0">notifications</span>
                  <p className="font-['Manrope'] text-sm text-white">{notificationMessage}</p>
                </div>
                <button
                  className="admin-notification-dismiss text-white/60 hover:text-white text-xs font-['Manrope'] uppercase tracking-widest ml-4 shrink-0"
                  onClick={() => setNotificationMessage('')} type="button"
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {/* ══════════════════════════════════════════
                LIVE ORDERS
            ══════════════════════════════════════════ */}
            {activeTab === 'orders' ? (
              <div className="admin-page admin-page-orders">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-12">
                  <div>
                    <h2 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] tracking-tight font-semibold">Live Orders</h2>
                    <p className="font-['Manrope'] text-[#5f5e5e] mt-2 text-sm tracking-wide">Currently monitoring active in-room dining requests.</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="font-['Manrope'] text-sm font-semibold tracking-wide text-[#4e4639] bg-[#f4f3f1] px-5 py-2 rounded-full border border-[#e3e2e0] hover:bg-[#e9e8e6] transition-colors"
                      onClick={() => setShowAllOrders((v) => !v)}
                      type="button"
                    >
                      {showAllOrders ? 'Today Only' : 'All Orders'}
                    </button>
                    <button
                      className="font-['Manrope'] text-sm font-semibold tracking-wide text-[#775a19] bg-[#c5a059]/20 px-5 py-2 rounded-full hover:bg-[#c5a059]/30 transition-colors"
                      onClick={toggleOrderPriorityFilter}
                      type="button"
                    >
                      {ordersAttentionOnly ? 'Show All' : 'Priority Filter'}
                    </button>
                    <button
                      className={`font-['Manrope'] text-sm font-semibold tracking-wide text-white px-5 py-2 rounded hover:bg-[#775a19]/90 transition-colors ${isOrderIntakePaused ? 'bg-[#1a1c1b]' : 'bg-[#775a19]'}`}
                      onClick={toggleOrderIntake}
                      type="button"
                    >
                      {isOrderIntakePaused ? 'Resume' : 'Pause'}
                    </button>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                  <div className="bg-white p-6 rounded shadow-[0_8px_24px_rgba(26,28,27,0.03)] border border-[#d1c5b4]/10">
                    <p className="font-['Manrope'] text-xs tracking-widest text-[#5f5e5e] uppercase mb-1">Total Active</p>
                    <p className="font-['Noto_Serif'] text-3xl text-[#1a1c1b]">{activeOrders.length}</p>
                  </div>
                  <div className="bg-white p-6 rounded shadow-[0_8px_24px_rgba(26,28,27,0.03)] border border-[#d1c5b4]/10">
                    <p className="font-['Manrope'] text-xs tracking-widest text-[#5f5e5e] uppercase mb-1">Avg. Prep Time</p>
                    <p className="font-['Noto_Serif'] text-3xl text-[#1a1c1b]">{averagePrepMinutes} <span className="font-['Manrope'] text-lg text-[#5f5e5e]">min</span></p>
                  </div>
                  <div className="bg-white p-6 rounded shadow-[0_8px_24px_rgba(26,28,27,0.03)] border border-[#d1c5b4]/10">
                    <p className="font-['Manrope'] text-xs tracking-widest text-[#5f5e5e] uppercase mb-1">Delayed</p>
                    <p className="font-['Noto_Serif'] text-3xl text-[#ba1a1a]">{slaBreachedCount}</p>
                  </div>
                </div>

                <div className="admin-order-queue-tabs mb-8" role="tablist" aria-label="Live order queues">
                  {ORDER_QUEUE_VIEWS.map((view) => {
                    const isSelected = orderQueueView === view.id;
                    return (
                      <button
                        key={view.id}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        className={`admin-order-queue-tab ${isSelected ? 'is-active' : ''}`}
                        onClick={() => {
                          setOrderQueueView(view.id);
                          if (view.id !== 'active') setOrdersAttentionOnly(false);
                        }}
                      >
                        <span className="admin-order-queue-tab-label">{view.label}</span>
                        <strong>{orderQueueSummary[view.id]}</strong>
                        <small>{view.helper}</small>
                      </button>
                    );
                  })}
                </div>

                {!dataLoaded ? (
                  <LoadingSkeleton lines={4} />
                ) : visibleOrders.length === 0 ? (
                  <div className="admin-empty-state-shell">
                    <div className="admin-empty-state-card admin-empty-state-card--orders">
                      <span className="admin-empty-state-icon material-symbols-outlined">
                        {orderQueueView === 'done' ? 'task_alt' : orderQueueView === 'cancelled' ? 'event_busy' : 'restaurant'}
                      </span>
                      <p className="admin-empty-state-eyebrow font-['Manrope']">
                        {orderQueueView === 'done' ? 'Completed Queue' : orderQueueView === 'cancelled' ? 'Cancelled Queue' : 'Active Queue'}
                      </p>
                      <h3 className="admin-empty-state-title">
                        {orderQueueView === 'done'
                          ? 'No completed orders yet.'
                          : orderQueueView === 'cancelled'
                            ? 'No cancelled orders yet.'
                            : 'No active orders right now.'}
                      </h3>
                      <p className="admin-empty-state-description font-['Manrope']">
                        {orderQueueView === 'done'
                          ? 'Delivered orders that reach the final handoff step will appear here for quick review and follow-up.'
                          : orderQueueView === 'cancelled'
                            ? 'Orders that are revoked, cancelled, or removed from service flow will collect here for audit visibility.'
                            : 'New guest orders will appear here as soon as they enter the service flow, so the team can react quickly.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {visibleOrders.map((order) => {
                      const sla = isOrderSlaBreached(order);
                      const primaryAction = getOrderNextAction(order.status);
                      return (
                        <div
                          key={order.id}
                          className={`overflow-hidden flex flex-col md:flex-row bg-white rounded shadow-[0_12px_32px_rgba(26,28,27,0.04)] ${
                            sla ? 'border-l-4 border-[#ba1a1a]' : 'border border-[#d1c5b4]/10'
                          }`}
                        >
                          <div className="p-6 md:w-[26%] bg-[#f4f3f1]/50 flex flex-col justify-between">
                            <div>
                              <span className={`inline-block px-3 py-1 text-xs font-['Manrope'] tracking-wide uppercase rounded-sm mb-5 ${
                                sla ? 'bg-[#ffdad6] text-[#93000a]' : STATUS_COLORS[order.status] || 'bg-[#e9e8e6] text-[#1a1c1b]'
                              }`}>
                                {sla ? 'Delayed' : formatStatusLabel(order.status)}
                              </span>
                              <h3 className="font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Suite {order.roomNumber}</h3>
                              <p className="font-['Manrope'] text-sm text-[#5f5e5e] mt-1">{getAdminGuestDisplayName(order.lastName)}</p>
                            </div>
                            <div className="mt-10">
                              <p className="font-['Manrope'] text-[10px] text-[#5f5e5e] tracking-widest uppercase">Ordered</p>
                              <p className="font-['Manrope'] font-medium text-[#1a1c1b] text-sm mt-1">
                                {getOrderClockLabel(order.createdAt)}
                                {' '}
                                ({formatRelativeTime(order.createdAt)})
                              </p>
                            </div>
                          </div>

                          <div className="p-6 flex-1 border-t md:border-t-0 md:border-l border-[#d1c5b4]/20 flex flex-col justify-between">
                            <ul className="space-y-3">
                              {order.items.map((item) => (
                                <li key={item.id} className="flex justify-between items-start gap-6">
                                  <div>
                                    <p className="font-['Manrope'] font-medium text-[#1a1c1b]">{item.qty}x {item.name}</p>
                                    {item.note ? <p className="font-['Manrope'] text-sm text-[#5f5e5e]">{item.note}</p> : null}
                                  </div>
                                  <span className="font-['Manrope'] text-sm text-[#5f5e5e]">{formatIdr(item.qty * item.price)}</span>
                                </li>
                              ))}
                            </ul>
                            <div className="mt-6 flex flex-wrap justify-between items-center gap-3 border-t border-[#d1c5b4]/10 pt-4">
                              <div className="flex items-center gap-3 flex-wrap">
                                {sla ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="material-symbols-outlined text-[#ba1a1a] text-[18px]">warning</span>
                                    <span className="font-['Manrope'] text-sm font-medium text-[#ba1a1a]">Kitchen attention required</span>
                                  </div>
                                ) : (
                                  <>
                                    <span className="font-['Manrope'] text-xs text-[#4e4639]">Total</span>
                                    <span className="font-['Noto_Serif'] text-base font-semibold text-[#775a19]">{formatIdr(order.total)}</span>
                                    <span className="font-['Manrope'] text-[10px] uppercase tracking-widest text-[#5f5e5e] bg-[#f4f3f1] px-2 py-0.5 rounded">{order.paymentMethod}</span>
                                    {order.rating ? <span className="font-['Manrope'] text-xs text-[#5f5e5e]">· {order.rating}/5 ★</span> : null}
                                  </>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-3 justify-end">
                                <button
                                  className="font-['Manrope'] text-sm text-[#775a19] px-3 py-2.5 transition-colors hover:text-[#5d4201]"
                                  onClick={() => handleMessageGuest(order)}
                                  type="button"
                                >
                                  Message Guest
                                </button>
                                {primaryAction ? (
                                  <button
                                    className={`px-4 py-2 rounded text-sm font-['Manrope'] font-medium transition ${
                                      order.status === 'incoming'
                                        ? 'border border-[#775a19] text-[#775a19] hover:bg-[#775a19]/5'
                                        : 'bg-[#8b6418] text-white hover:bg-[#775a19]'
                                    }`}
                                    disabled={busyActionId === `status-${order.id}`}
                                    onClick={() => updateOrderStatus(order.id, primaryAction.nextStatus)}
                                    type="button"
                                  >
                                    {busyActionId === `status-${order.id}` ? 'Updating...' : primaryAction.label}
                                  </button>
                                ) : null}
                                {!primaryAction && !order.isRead ? (
                                  <button
                                    className="font-['Manrope'] text-sm font-medium bg-[#efeeec] text-[#1a1c1b] px-4 py-2 rounded transition-colors hover:bg-[#e9e8e6]"
                                    disabled={busyActionId === `read-${order.id}`}
                                    onClick={() => markAsRead(order.id)} type="button"
                                  >
                                    {busyActionId === `read-${order.id}` ? 'Updating...' : 'Mark as Read'}
                                  </button>
                                ) : null}
                                {identity.role === 'manager' && canRevokeOrderAccess(order) ? (
                                  <button
                                    className="font-['Manrope'] text-sm font-medium text-[#ba1a1a] px-4 py-2 rounded border border-[#ba1a1a]/20 hover:bg-[#ffdad6] transition-colors disabled:opacity-50 flex items-center gap-1"
                                    disabled={revokingSessionId === `revoke-order-${order.id}`}
                                    onClick={() => handleRevokeOrder(order)}
                                    type="button"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">block</span>
                                    {revokingSessionId === `revoke-order-${order.id}` ? 'Revoking...' : 'Revoke'}
                                  </button>
                                ) : null}
                                {identity.role === 'manager' ? (
                                  <button
                                    className="font-['Manrope'] text-sm font-medium text-[#ba1a1a] px-4 py-2 rounded border border-[#ba1a1a]/20 hover:bg-[#ffdad6] transition-colors disabled:opacity-50 flex items-center gap-1"
                                    disabled={busyActionId === `delete-order-${order.id}`}
                                    onClick={() => deleteOrder(order)}
                                    type="button"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">delete</span>
                                    {busyActionId === `delete-order-${order.id}` ? 'Deleting...' : 'Delete'}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {/* ══════════════════════════════════════════
                MENU MANAGER
            ══════════════════════════════════════════ */}
            {activeTab === 'menu' ? (
              <div className="admin-page admin-page-menu">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-14 gap-6">
                  <div>
                    <h2 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] tracking-tight font-semibold mb-2">Curated Offerings</h2>
                    <p className="font-['Manrope'] text-[#4e4639] max-w-md text-sm">Manage the culinary portfolio for in-room dining. Adjust availability to reflect real-time kitchen capacity.</p>
                  </div>
                  <button
                    className="bg-[#775a19] text-white px-6 py-3 rounded text-sm font-['Manrope'] font-medium tracking-wide hover:bg-[#c5a059] hover:text-[#4e3700] transition-all flex items-center gap-2 shadow-[0_8px_16px_rgba(119,90,25,0.15)] shrink-0"
                    onClick={() => setEditingProduct(getEditorState())} type="button"
                  >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                    Add New Creation
                  </button>
                </div>

                <div className="mb-12 flex gap-8 overflow-x-auto border-b border-[#e9e8e6] pb-4">
                  {menuCategories.map((category) => {
                    const isActive = activeMenuCategory === category;
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setActiveMenuCategory(category)}
                        className={`relative whitespace-nowrap font-['Manrope'] text-sm uppercase tracking-[0.1em] transition-colors ${
                          isActive ? 'font-semibold text-[#775a19]' : 'text-[#4e4639] hover:text-[#775a19]'
                        }`}
                      >
                        {category}
                        {isActive ? <span className="absolute -bottom-4 left-0 h-[2px] w-full bg-[#775a19]" /> : null}
                      </button>
                    );
                  })}
                </div>

                {/* Product grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {visibleProducts.map((product) => (
                    <article key={product.id} className="group bg-white rounded-lg overflow-hidden relative shadow-[0_4px_20px_rgba(26,28,27,0.02)] transition-transform duration-300 hover:-translate-y-1">
                      <div className="h-64 overflow-hidden relative bg-[#e9e8e6]">
                        {product.image ? (
                          <img src={product.image} alt={product.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <span className="material-symbols-outlined text-[#d1c5b4] text-[48px]">restaurant_menu</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-white/90 via-white/20 to-transparent" />
                        <div className="absolute top-4 left-4 bg-white/85 backdrop-blur-md px-3 py-1 rounded-full flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${product.isAvailable ? 'bg-[#4caf50]' : 'bg-[#ba1a1a]'}`} />
                          <span className="font-['Manrope'] text-xs uppercase tracking-wider text-[#1a1c1b] font-semibold">
                            {product.isAvailable ? 'Available' : 'Offline'}
                          </span>
                        </div>
                      </div>
                      <div className="p-6 relative -mt-8">
                        <div className="flex justify-between items-start gap-4 mb-2">
                          <h3 className="font-['Noto_Serif'] text-xl leading-tight text-[#1a1c1b] w-3/4">{product.name}</h3>
                          <span className="font-['Noto_Serif'] text-lg text-[#775a19]">{formatIdr(product.price)}</span>
                        </div>
                        <p className={`font-['Manrope'] text-sm text-[#4e4639] mb-6 line-clamp-2 ${product.isAvailable ? '' : 'opacity-75'}`}>{product.description}</p>
                        <div className="flex justify-between items-center pt-4 border-t border-[#f4f3f1]">
                          <div className="flex gap-1">
                            <button
                              className="text-[#775a19] hover:text-[#4e3700] transition-colors p-2 rounded-full hover:bg-[#f4f3f1]"
                              onClick={() => setEditingProduct(getEditorState(product))} type="button"
                            >
                              <span className="material-symbols-outlined text-[20px]">edit</span>
                            </button>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              aria-label={`${product.isAvailable ? 'Disable' : 'Enable'} ${product.name}`}
                              aria-checked={product.isAvailable}
                              className={`admin-availability-switch ${product.isAvailable ? 'is-on' : 'is-off'}`}
                              disabled={busyActionId === `product-${product.id}`}
                              onClick={() => toggleProductAvailability(product)}
                              role="switch"
                              type="button"
                            >
                              <span className="admin-availability-switch-label">
                                {product.isAvailable ? 'ON' : 'OFF'}
                              </span>
                              <span className="admin-availability-switch-track">
                                <span className="admin-availability-switch-thumb" />
                              </span>
                            </button>
                            {identity.role === 'manager' ? (
                              <button
                                aria-label={`Remove ${product.name}`}
                                className="text-[#ba1a1a] hover:text-[#93000a] transition-colors p-2 rounded-full hover:bg-[#ffdad6]"
                                disabled={busyActionId === `delete-product-${product.id}`}
                                onClick={() => deleteProduct(product.id)} type="button"
                              >
                                <span className="material-symbols-outlined text-[20px]">delete</span>
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                  {!dataLoaded ? (
                    <div className="col-span-full"><LoadingSkeleton lines={4} /></div>
                  ) : visibleProducts.length === 0 ? (
                    <div className="col-span-full admin-empty-state-shell">
                      <div className="admin-empty-state-card admin-empty-state-card--menu">
                        <span className="admin-empty-state-icon material-symbols-outlined">menu_book</span>
                        <p className="admin-empty-state-eyebrow font-['Manrope']">Menu Manager</p>
                        <h3 className="admin-empty-state-title">No items match your search.</h3>
                        <p className="admin-empty-state-description font-['Manrope']">Try another keyword or add a new creation so the catalog stays clean and easy to scan on iPad.</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* ══════════════════════════════════════════
                FEEDBACK
            ══════════════════════════════════════════ */}
            {activeTab === 'feedback' ? (
              <div className="admin-page admin-page-feedback">
                <div className="flex flex-col md:flex-row md:justify-between md:items-end mb-10 gap-6">
                  <div className="max-w-2xl">
                    <span className="uppercase tracking-[0.1em] text-xs font-bold text-[#775a19] mb-3 block font-['Manrope']">Guest Relations</span>
                    <h2 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] tracking-tight font-semibold mb-3">Guest Feedback</h2>
                    <p className="font-['Manrope'] text-[#4e4639] text-base font-light leading-relaxed">Review ratings, written comments, and follow-up requests from recent dining orders.</p>
                  </div>
                  <div className="flex gap-4 shrink-0">
                    <div className="bg-[#f4f3f1] p-5 rounded min-w-[140px]">
                      <span className="block text-sm text-[#4e4639] font-['Manrope'] mb-1">Avg Rating</span>
                      <div className="flex items-baseline gap-2">
                        <span className="font-['Noto_Serif'] text-3xl text-[#1a1c1b]">{averageRating}</span>
                        <span className="material-symbols-outlined text-[#775a19] text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                      </div>
                    </div>
                    <div className="bg-[#f4f3f1] p-5 rounded min-w-[140px]">
                      <span className="block text-sm text-[#4e4639] font-['Manrope'] mb-1">Recent Reviews</span>
                      <span className="font-['Noto_Serif'] text-3xl text-[#1a1c1b]">{feedbackOrders.length}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 mb-12 items-center justify-start">
                  <div className="flex flex-wrap gap-3 flex-1">
                    {[
                      { id: 'all' as const, label: 'All Ratings' },
                      { id: '5' as const, label: '5 Stars' },
                      { id: '4' as const, label: '4 Stars' },
                      { id: 'week' as const, label: 'This Week' },
                    ].map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setFeedbackFilter(option.id)}
                        className={`rounded-full border px-6 py-3 font-['Manrope'] text-xs uppercase tracking-widest transition ${
                          feedbackFilter === option.id
                            ? 'border-[#775a19] bg-white text-[#775a19]'
                            : 'border-[#d1c5b4]/40 bg-white text-[#4e4639] hover:bg-[#f4f3f1]'
                        }`}
                      >
                        {option.id === 'all' ? <span className="inline-flex items-center gap-2"><span className="material-symbols-outlined text-[16px]">filter_list</span>{option.label}</span> : null}
                        {option.id === '5' ? <span className="inline-flex items-center gap-1">5<span className="material-symbols-outlined text-[15px] text-[#775a19]" style={{ fontVariationSettings: "'FILL' 1" }}>star</span></span> : null}
                        {option.id === '4' ? <span className="inline-flex items-center gap-1">4<span className="material-symbols-outlined text-[15px] text-[#775a19]" style={{ fontVariationSettings: "'FILL' 1" }}>star</span></span> : null}
                        {option.id === 'week' ? <span className="inline-flex items-center gap-2"><span className="material-symbols-outlined text-[16px]">calendar_today</span>{option.label}</span> : null}
                      </button>
                    ))}
                  </div>
                  {identity.role === 'manager' ? (
                    <button
                      type="button"
                      onClick={clearAllResolvedFeedback}
                      className="font-['Manrope'] text-xs font-semibold tracking-wide text-[#ba1a1a] bg-red-50 px-4 py-2 rounded-full border border-red-100 hover:bg-red-100 transition-colors shrink-0"
                    >
                      Dismiss All Resolved
                    </button>
                  ) : null}
                </div>

                {!dataLoaded ? (
                  <LoadingSkeleton lines={4} />
                ) : filteredFeedbackOrders.length === 0 ? (
                  <div className="admin-empty-state-shell">
                    <div className="admin-empty-state-card admin-empty-state-card--feedback">
                      <span className="admin-empty-state-icon material-symbols-outlined">reviews</span>
                      <p className="admin-empty-state-eyebrow font-['Manrope']">Guest Relations</p>
                      <h3 className="admin-empty-state-title">No guest feedback yet.</h3>
                      <p className="admin-empty-state-description font-['Manrope']">Fresh ratings and guest notes will appear here once completed dining orders send feedback back into the dashboard.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div className={`grid grid-cols-1 ${feedbackSideOrder ? 'lg:grid-cols-[1.45fr_0.7fr]' : ''} gap-8`}>
                      {feedbackHeroOrder ? (
                        <article className={`bg-white p-8 rounded relative group shadow-[0_10px_30px_rgba(26,28,27,0.03)] border border-[#d1c5b4]/20 ${feedbackSideOrder ? 'lg:col-span-2' : ''}`}>
                          <div className="flex items-start justify-between gap-5">
                            <div>
                              <div className="mb-5 flex items-center gap-1">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <span
                                    key={star}
                                    className="material-symbols-outlined text-[28px]"
                                    style={{
                                      fontVariationSettings: "'FILL' 1",
                                      color: star <= (feedbackHeroOrder.rating || 0) ? '#8b6418' : '#d8d1c6',
                                    }}
                                  >
                                    star
                                  </span>
                                ))}
                              </div>
                              <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">
                                {buildFeedbackHeadline(feedbackHeroOrder)}
                              </h3>
                            </div>
                            <span className="font-['Manrope'] text-xs uppercase tracking-widest text-[#4e4639] bg-[#f4f3f1] px-3 py-1 rounded">
                              Suite {feedbackHeroOrder.roomNumber}
                            </span>
                          </div>
                          <p className="font-['Manrope'] text-[#4e4639] leading-relaxed mb-8 mt-0">
                            "{buildFeedbackQuote(feedbackHeroOrder)}"
                          </p>
                          <div className="flex justify-between items-end border-t border-[#e3e2e0]/50 pt-6 mt-auto">
                            <div className="flex items-center gap-4">
                              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1a1c1b] text-white">
                                {getAdminGuestDisplayName(feedbackHeroOrder.lastName).slice(0, 1)}
                              </div>
                              <div>
                                <p className="font-['Manrope'] text-base text-[#1a1c1b]">{getAdminGuestDisplayName(feedbackHeroOrder.lastName)}</p>
                                <p className="font-['Manrope'] text-sm text-[#5f5e5e]">{formatFeedbackTime(feedbackHeroOrder.createdAt)}</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                              <button className="text-[#775a19] font-['Manrope'] text-sm uppercase tracking-widest hover:text-[#c5a059] transition-colors" onClick={() => acknowledgeFeedback(feedbackHeroOrder)} type="button">
                                Acknowledge
                              </button>
                              {identity.role === 'manager' ? (
                                <button className="text-[#ba1a1a] font-['Manrope'] text-sm uppercase tracking-widest hover:bg-[#ffdad6] px-2 py-1 rounded transition-colors" disabled={busyActionId === `delete-feedback-${feedbackHeroOrder.id}`} onClick={() => deleteFeedback(feedbackHeroOrder)} type="button">
                                  {busyActionId === `delete-feedback-${feedbackHeroOrder.id}` ? 'Deleting...' : 'Delete'}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      ) : null}

                      {feedbackSideOrder ? (
                        <article className="bg-white p-8 rounded relative group shadow-[0_10px_30px_rgba(26,28,27,0.03)] border border-[#d1c5b4]/20 flex flex-col">
                          <div className="flex items-start justify-between gap-4">
                            <div className="mb-4 flex items-center gap-1">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <span
                                  key={star}
                                  className="material-symbols-outlined text-[24px]"
                                  style={{
                                    fontVariationSettings: "'FILL' 1",
                                    color: star <= (feedbackSideOrder.rating || 0) ? '#8b6418' : '#d8d1c6',
                                  }}
                                >
                                  star
                                </span>
                              ))}
                            </div>
                            <span className="font-['Manrope'] text-xs uppercase tracking-widest text-[#4e4639]">Suite {feedbackSideOrder.roomNumber}</span>
                          </div>
                          <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b] mb-3">
                            {buildFeedbackHeadline(feedbackSideOrder)}
                          </h3>
                          <p className="font-['Manrope'] text-[#4e4639] text-sm leading-relaxed mb-8 flex-grow">
                            "{buildFeedbackQuote(feedbackSideOrder)}"
                          </p>
                          <div className="flex justify-between items-end border-t border-[#e3e2e0]/50 pt-4">
                            <p className="font-['Manrope'] text-sm text-[#5f5e5e]">{formatFeedbackTime(feedbackSideOrder.createdAt)}</p>
                            <div className="flex flex-wrap justify-end gap-2">
                              <button className="text-[#775a19] font-['Manrope'] text-xs uppercase tracking-widest hover:text-[#c5a059] transition-colors" onClick={() => replyToFeedback(feedbackSideOrder)} type="button">
                                Reply
                              </button>
                              {identity.role === 'manager' ? (
                                <button className="text-[#ba1a1a] font-['Manrope'] text-xs uppercase tracking-widest hover:bg-[#ffdad6] px-2 py-1 rounded transition-colors" disabled={busyActionId === `delete-feedback-${feedbackSideOrder.id}`} onClick={() => deleteFeedback(feedbackSideOrder)} type="button">
                                  {busyActionId === `delete-feedback-${feedbackSideOrder.id}` ? 'Deleting...' : 'Delete'}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      ) : null}
                    </div>

                    {(feedbackIssueOrder || feedbackStoryOrder) ? <div className={`grid grid-cols-1 ${feedbackIssueOrder && feedbackStoryOrder ? 'lg:grid-cols-[0.7fr_1.3fr]' : ''} gap-8`}>
                      {feedbackIssueOrder ? (
                        <article className="bg-white p-8 rounded relative group shadow-[0_10px_30px_rgba(26,28,27,0.03)] border-l-4 border-[#ba1a1a]/50 flex flex-col">
                          <div>
                            <div className="flex items-start justify-between gap-4">
                              <div className="mb-4 flex items-center gap-1">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <span
                                    key={star}
                                    className="material-symbols-outlined text-[24px]"
                                    style={{
                                      fontVariationSettings: "'FILL' 1",
                                      color: star <= (feedbackIssueOrder.rating || 0) ? '#ba1a1a' : '#d8d1c6',
                                    }}
                                  >
                                    star
                                  </span>
                                ))}
                              </div>
                              <span className="font-['Manrope'] text-xs uppercase tracking-widest text-[#4e4639]">Suite {feedbackIssueOrder.roomNumber}</span>
                            </div>
                            <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b] mb-3">
                              {buildFeedbackHeadline(feedbackIssueOrder)}
                            </h3>
                            <p className="font-['Manrope'] text-[#4e4639] text-sm leading-relaxed mb-8 flex-grow">
                              "{buildFeedbackQuote(feedbackIssueOrder)}"
                            </p>
                            <div className="flex justify-between items-end border-t border-[#ba1a1a]/10 pt-4">
                              <div>
                                <p className="font-['Manrope'] text-xs text-[#ba1a1a] font-medium">Action Required</p>
                                <p className="font-['Manrope'] text-xs text-[#5f5e5e]">{formatFeedbackTime(feedbackIssueOrder.createdAt)}</p>
                              </div>
                              <div className="flex flex-wrap justify-end gap-2">
                                <button className="text-[#ba1a1a] font-['Manrope'] text-xs uppercase tracking-widest hover:bg-[#ba1a1a]/5 px-2 py-1 rounded transition-colors" onClick={() => resolveFeedback(feedbackIssueOrder)} type="button">
                                  Resolve
                                </button>
                                {identity.role === 'manager' ? (
                                  <button className="text-[#ba1a1a] font-['Manrope'] text-xs uppercase tracking-widest hover:bg-[#ffdad6] px-2 py-1 rounded transition-colors" disabled={busyActionId === `delete-feedback-${feedbackIssueOrder.id}`} onClick={() => deleteFeedback(feedbackIssueOrder)} type="button">
                                    {busyActionId === `delete-feedback-${feedbackIssueOrder.id}` ? 'Deleting...' : 'Delete'}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </article>
                      ) : null}

                      {feedbackStoryOrder ? (
                        <article className="bg-white p-8 rounded relative group lg:col-span-2 shadow-[0_10px_30px_rgba(26,28,27,0.03)] border border-[#d1c5b4]/20 flex flex-col md:flex-row gap-8">
                          <div className="flex-1">
                            <div>
                              <div className="mb-4 flex items-center gap-1">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <span
                                    key={star}
                                    className="material-symbols-outlined text-[24px]"
                                    style={{
                                      fontVariationSettings: "'FILL' 1",
                                      color: star <= (feedbackStoryOrder.rating || 0) ? '#8b6418' : '#d8d1c6',
                                    }}
                                  >
                                    star
                                  </span>
                                ))}
                              </div>
                              <div className="mb-6 flex items-center justify-between gap-4">
                                <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">
                                  {buildFeedbackHeadline(feedbackStoryOrder)}
                                </h3>
                                <span className="font-['Manrope'] text-xs uppercase tracking-widest text-[#4e4639] bg-[#f4f3f1] px-3 py-1 rounded">
                                  Suite {feedbackStoryOrder.roomNumber}
                                </span>
                              </div>
                              <p className="font-['Manrope'] text-[#4e4639] text-sm leading-relaxed mb-6">
                                "{buildFeedbackQuote(feedbackStoryOrder)}"
                              </p>
                            </div>
                          </div>
                          <div className="md:w-64 flex flex-col justify-between border-t md:border-t-0 md:border-l border-[#e3e2e0]/50 pt-6 md:pt-0 md:pl-8">
                            <div>
                              <p className="font-['Manrope'] text-sm font-medium text-[#1a1c1b] mb-1">Ordered Items</p>
                              <ul className="font-['Manrope'] text-xs text-[#4e4639] space-y-1">
                                {feedbackStoryOrder.items.slice(0, 4).map((item) => (
                                  <li key={item.id}>- {item.name}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                          <div className="mt-6 flex justify-between items-center w-full">
                            <p className="font-['Manrope'] text-xs text-[#5f5e5e]">{formatFeedbackTime(feedbackStoryOrder.createdAt)}</p>
                            <div className="flex flex-wrap justify-end gap-2">
                              <button className="text-[#775a19] font-['Manrope'] text-xs uppercase tracking-widest hover:text-[#c5a059] transition-colors" onClick={() => acknowledgeFeedback(feedbackStoryOrder)} type="button">
                                Acknowledge
                              </button>
                              {identity.role === 'manager' ? (
                                <button className="text-[#ba1a1a] font-['Manrope'] text-xs uppercase tracking-widest hover:bg-[#ffdad6] px-2 py-1 rounded transition-colors" disabled={busyActionId === `delete-feedback-${feedbackStoryOrder.id}`} onClick={() => deleteFeedback(feedbackStoryOrder)} type="button">
                                  {busyActionId === `delete-feedback-${feedbackStoryOrder.id}` ? 'Deleting...' : 'Delete'}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      ) : null}
                    </div> : null}
                  </div>
                )}
              </div>
            ) : null}

            {/* ══════════════════════════════════════════
                REVENUE
            ══════════════════════════════════════════ */}
            {activeTab === 'revenue' ? (
              <ManagerOnly role={identity.role}>
                {!dataLoaded ? (
                  <div className="admin-page admin-page-revenue">
                    <LoadingSkeleton lines={4} />
                  </div>
                ) : (
                <div className="admin-page admin-page-revenue">
                  <div className="mb-10">
                    <h2 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] tracking-tight font-semibold">Revenue</h2>
                    <p className="font-['Manrope'] text-[#5f5e5e] mt-2 text-sm tracking-wide">Track financial performance and export reports for accounting.</p>
                  </div>
                  <div className="admin-revenue-toolbar flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-12">
                    <div className="admin-revenue-range-toggle revenue-range-toggle flex gap-2 bg-[#f4f3f1] p-1 rounded-full border border-[#e3e2e0]/50">
                      {(['daily', 'weekly', 'monthly'] as const).map((range) => (
                        <button
                          key={range}
                          type="button"
                          onClick={() => setRevenueRange(range)}
                          className={`rounded-full px-6 py-2 font-['Manrope'] font-medium text-sm transition ${
                            revenueRange === range ? 'bg-white text-[#775a19] shadow-sm' : 'text-[#5f5e5e] hover:bg-white/50'
                          }`}
                        >
                          {range[0].toUpperCase() + range.slice(1)}
                        </button>
                      ))}
                    </div>
                    <button
                      className="flex items-center gap-2 text-[#775a19] font-['Manrope'] font-medium text-sm px-4 py-2 border border-[#d1c5b4]/30 rounded hover:bg-[#f4f3f1] transition-colors"
                      onClick={exportRevenue} type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]">download</span>
                      Export Report
                    </button>
                  </div>

                  {/* KPI Grid */}
                  <div className="admin-revenue-kpi-grid grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                    <div className="admin-revenue-kpi-card bg-white rounded-lg p-8 shadow-[0_20px_40px_rgba(26,28,27,0.06)] relative overflow-hidden group">
                      <div className="absolute -right-8 -top-8 w-32 h-32 bg-[#c5a059]/10 rounded-full blur-2xl group-hover:bg-[#c5a059]/20 transition-all" />
                      <p className="font-['Manrope'] text-xs uppercase tracking-widest text-[#5f5e5e] mb-2">Total Revenue</p>
                      <h3 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] mb-4 tracking-tight">{formatIdr(revenueOverview.revenue)}</h3>
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`material-symbols-outlined text-sm mr-1 ${revenueOverview.revenueDelta >= 0 ? 'text-[#775a19]' : 'text-[#ba1a1a]'}`}>
                          {revenueOverview.revenueDelta >= 0 ? 'trending_up' : 'trending_down'}
                        </span>
                        <span className={`font-['Manrope'] font-medium text-xs ${revenueOverview.revenueDelta >= 0 ? 'text-[#775a19]' : 'text-[#ba1a1a]'}`}>
                          {`${revenueOverview.revenueDelta >= 0 ? '+' : ''}${revenueOverview.revenueDelta.toFixed(1)}%`}
                        </span>
                        <span className="font-['Manrope'] text-xs text-[#5f5e5e]">vs last period</span>
                      </div>
                    </div>
                    <div className="admin-revenue-kpi-card bg-[#f4f3f1] rounded-lg p-8 relative overflow-hidden border border-[#e3e2e0]/30">
                      <p className="font-['Manrope'] text-xs uppercase tracking-widest text-[#5f5e5e] mb-2">Average Order Value</p>
                      <h3 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] mb-4 tracking-tight">{formatIdr(revenueOverview.averageOrderValue)}</h3>
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`material-symbols-outlined text-sm mr-1 ${revenueOverview.averageDelta >= 0 ? 'text-[#775a19]' : 'text-[#ba1a1a]'}`}>
                          {revenueOverview.averageDelta >= 0 ? 'trending_up' : 'trending_down'}
                        </span>
                        <span className={`font-['Manrope'] font-medium text-xs ${revenueOverview.averageDelta >= 0 ? 'text-[#775a19]' : 'text-[#ba1a1a]'}`}>
                          {`${revenueOverview.averageDelta >= 0 ? '+' : ''}${revenueOverview.averageDelta.toFixed(1)}%`}
                        </span>
                        <span className="font-['Manrope'] text-xs text-[#5f5e5e]">vs last period</span>
                      </div>
                    </div>
                    <div className="admin-revenue-kpi-card bg-[#f4f3f1] rounded-lg p-8 relative overflow-hidden border border-[#e3e2e0]/30">
                      <p className="font-['Manrope'] text-xs uppercase tracking-widest text-[#5f5e5e] mb-2">Total Orders</p>
                      <h3 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] mb-4 tracking-tight">{revenueOverview.totalOrders}</h3>
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`material-symbols-outlined text-sm mr-1 ${revenueOverview.ordersDelta >= 0 ? 'text-[#775a19]' : 'text-[#ba1a1a]'}`}>
                          {revenueOverview.ordersDelta >= 0 ? 'trending_up' : 'trending_down'}
                        </span>
                        <span className={`font-['Manrope'] font-medium text-xs ${revenueOverview.ordersDelta >= 0 ? 'text-[#775a19]' : 'text-[#ba1a1a]'}`}>
                          {`${revenueOverview.ordersDelta >= 0 ? '+' : ''}${revenueOverview.ordersDelta.toFixed(1)}%`}
                        </span>
                        <span className="font-['Manrope'] text-xs text-[#5f5e5e]">vs last period</span>
                      </div>
                    </div>
                  </div>

                  <div className="w-full bg-white rounded-xl p-8 mb-12 shadow-[0_20px_40px_rgba(26,28,27,0.06)] h-[280px] flex flex-col">
                    <div className="mb-8 flex items-center justify-between gap-4">
                      <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">Revenue Trend</h3>
                      <button className="text-[#5f5e5e]" onClick={() => showDashboardNotice(`Revenue range: ${revenueRange}. Export Report downloads the current data set.`)} type="button" aria-label="Show revenue chart options">
                        <span className="material-symbols-outlined">more_horiz</span>
                      </button>
                    </div>
                    <div className="relative flex-1 mt-8">
                      <div className="absolute left-0 top-0 hidden h-full flex-col justify-between py-4 pl-2 text-xs text-[#7c7366] sm:flex">
                        {[1, 0.8, 0.6, 0.4, 0.2].map((step) => (
                          <span key={step}>{formatCompactCurrency(Math.max(...revenueTrend.map((point) => point.value), 0) * step)}</span>
                        ))}
                      </div>
                      <div
                        className="pl-10"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: `repeat(${revenueTrend.length}, minmax(0, 1fr))`,
                          gap: '0.5rem',
                          alignItems: 'end',
                        }}
                      >
                        {(() => {
                          const maxVal = Math.max(...revenueTrend.map((p) => p.value), 1);
                          const todayLabel = revenueAnchorDate.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
                          const currentWeekIndex = Math.min(3, Math.floor((revenueAnchorDate.getDate() - 1) / 7));
                          return revenueTrend.map((point) => {
                            const isActive = revenueRange === 'monthly'
                              ? point.label === `Week ${currentWeekIndex + 1}`
                              : point.label === todayLabel;
                            const barHeightPct = (point.value / maxVal) * 100;
                            return (
                              <div key={point.label} className="flex flex-col items-center">
                                <div
                                  className="relative w-full"
                                  style={{ height: 'clamp(12rem, 22vw, 17rem)', borderBottom: '1px solid rgba(235,226,214,0.6)' }}
                                >
                                  <div
                                    className={`group absolute bottom-0 left-1/2 -translate-x-1/2 w-3/4 max-w-[3rem] rounded-t-sm transition-colors cursor-pointer ${isActive ? 'bg-[#8b6418]/80 shadow-[0_0_15px_rgba(197,160,89,0.3)]' : 'bg-[#e3e2e0] hover:bg-[#c5a059]/30'}`}
                                    style={{ height: `${Math.max(4, barHeightPct)}%` }}
                                  >
                                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[#2f3130] text-white text-[10px] px-2 py-1 rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                      {formatIdr(point.value)}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-2 text-center">
                                  <p className={`font-['Manrope'] text-xs uppercase tracking-[0.16em] ${isActive ? 'font-bold text-[#775a19]' : 'text-[#7c7366]'}`}>{point.label}</p>
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.92fr] gap-12">
                    <div>
                      <h3 className="mb-6 border-b border-[#ece5db] pb-4 font-['Noto_Serif'] text-xl text-[#1a1c1b]">Top Performing Signatures</h3>
                      <div className="space-y-6">
                        {visibleRevenueLeaders.map((item) => (
                          <div key={item.name} className="flex items-center justify-between p-4 bg-white rounded-lg hover:bg-[#f4f3f1] transition-colors group cursor-pointer shadow-[0_20px_40px_rgba(26,28,27,0.06)]">
                            <div className="flex items-center gap-4">
                              <div className="w-16 h-16 rounded overflow-hidden relative bg-[#e3e2e0]">
                                {item.image ? (
                                  <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <span className="material-symbols-outlined text-[#d1c5b4]">restaurant</span>
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="font-['Manrope'] font-medium text-[#1a1c1b] mb-1">{item.name}</p>
                                <p className="font-['Manrope'] text-xs text-[#5f5e5e]">{item.orders} Orders</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`font-['Noto_Serif'] text-lg ${item === visibleRevenueLeaders[0] ? 'text-[#775a19]' : 'text-[#1a1c1b]'}`}>{formatIdr(item.revenue)}</p>
                              <p className="font-['Manrope'] text-xs text-[#5f5e5e]">
                                {revenueOverview.revenue ? `${((item.revenue / revenueOverview.revenue) * 100).toFixed(1)}% of rev` : '0% of rev'}
                              </p>
                            </div>
                          </div>
                        ))}
                        {visibleRevenueLeaders.length === 0 ? <p className="text-sm text-[#4e4639]">No signature data available for the current filter.</p> : null}
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <h3 className="mb-6 border-b border-[#ece5db] pb-4 font-['Noto_Serif'] text-xl text-[#1a1c1b]">Revenue Distribution</h3>
                        <div className="space-y-8 mt-8 px-4">
                          {visibleRevenueDistribution.map((segment, index) => (
                            <div key={segment.label}>
                              <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                                <span className="font-medium text-[#1a1c1b]">{segment.label}</span>
                                <span className={`font-['Noto_Serif'] ${index === 0 ? 'text-[#775a19]' : 'text-[#1a1c1b]'}`}>{formatIdr(segment.revenue)}</span>
                              </div>
                              <div className="w-full h-2 bg-[#e9e8e6] rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${index === 0 ? 'bg-[#775a19]' : index === 1 ? 'bg-[#c5a059]' : 'bg-[#d1c5b4]'}`}
                                  style={{ width: `${Math.max(segment.percent, 8)}%` }}
                                />
                              </div>
                            </div>
                          ))}
                          {visibleRevenueDistribution.length === 0 ? <p className="text-sm text-[#4e4639]">No revenue distribution data available for the current filter.</p> : null}
                        </div>
                      </div>

                      <div className="mt-12 bg-[#f4f3f1] p-6 rounded-lg border border-[#e3e2e0]/30">
                        <p className="mb-3 font-['Manrope'] text-xs uppercase tracking-widest text-[#5f5e5e]">Insight</p>
                        <p className="font-['Manrope'] text-sm leading-7 text-[#4e4639]">
                          {visibleRevenueDistribution[0]
                            ? `${visibleRevenueDistribution[0].label} currently leads revenue contribution at ${visibleRevenueDistribution[0].percent}% of completed order value for the selected period.`
                            : 'Review completed orders by date to track revenue trends and identify peak service windows.'}
                        </p>
                      </div>
                    </div>
                  </div>
                  {revenueSummary.rows.length === 0 && dataLoaded ? (
                    <div className="admin-empty-state-shell">
                      <div className="admin-empty-state-card admin-empty-state-card--revenue">
                        <span className="admin-empty-state-icon material-symbols-outlined">payments</span>
                        <p className="admin-empty-state-eyebrow font-['Manrope']">Revenue</p>
                        <h3 className="admin-empty-state-title">No revenue data for this period.</h3>
                        <p className="admin-empty-state-description font-['Manrope']">Complete and delivered orders with payment will appear here once processed through the service workflow.</p>
                      </div>
                    </div>
                  ) : null}
                </div>
                )}
              </ManagerOnly>
            ) : null}

            {/* ══════════════════════════════════════════
                SHIFT HANDOVER NOTES
            ══════════════════════════════════════════ */}
            {activeTab === 'handover' ? (
              <div className="admin-page admin-page-handover">
                <div className="mb-10">
                  <h2 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] tracking-tight font-semibold">Handover Notes</h2>
                  <p className="font-['Manrope'] text-[#5f5e5e] mt-2 text-sm">Leave notes for the incoming shift to ensure service continuity.</p>
                </div>
                <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                  {/* Compose */}
                  <div className={`${ELEVATED_PANEL_CLASS} p-6`}>
                    <div className="flex items-center gap-3 mb-5">
                      <span className="material-symbols-outlined text-[#775a19] text-[22px]">description</span>
                      <h3 className="font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Leave a Note</h3>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold mb-2">Shift</p>
                        <div className="flex gap-2 flex-wrap">
                          {(['morning', 'afternoon', 'night'] as ShiftName[]).map((s) => (
                            <button
                              key={s}
                              className={`font-['Manrope'] text-xs uppercase tracking-widest font-semibold px-3 py-2 rounded transition-colors ${
                                activeShift === s ? 'bg-[#1a1c1b] text-white' : 'border border-[#d1c5b4]/50 text-[#4e4639] hover:bg-[#f4f3f1]'
                              }`}
                              onClick={() => setActiveShift(s)} type="button"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 font-['Manrope'] text-xs text-[#4e4639]">{SHIFT_LABELS[activeShift]}</p>
                      </div>
                      <div>
                        <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold mb-2">Note</p>
                        <textarea
                          className="w-full bg-[#f4f3f1] border-none rounded-[18px] px-4 py-3 font-['Manrope'] text-sm text-[#1a1c1b] outline-none resize-none min-h-[140px] placeholder:text-[#4e4639]/50 ring-1 ring-[#ece5db]"
                          placeholder="Write shift-critical context for the next operator."
                          value={handoverDraft}
                          onChange={(e) => setHandoverDraft(e.target.value)}
                        />
                      </div>
                      <button
                        className="w-full bg-[#775a19] text-white font-['Manrope'] text-xs uppercase tracking-widest font-semibold py-3 rounded-[14px] hover:bg-[#775a19]/90 transition-colors shadow-[0_10px_24px_rgba(119,90,25,0.18)] disabled:opacity-50"
                        disabled={!handoverDraft.trim() || isSavingNote}
                        onClick={saveHandoverNote} type="button"
                      >
                        {isSavingNote ? 'Saving…' : 'Post Note'}
                      </button>
                    </div>
                  </div>

                  {/* Notes per shift */}
                  <div className="space-y-4">
                    {(['morning', 'afternoon', 'night'] as ShiftName[]).map((s) => {
                      const notes = shiftNotesByShift[s];
                      return (
                        <div key={s} className={`${ELEVATED_PANEL_CLASS} p-5`}>
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold capitalize">{s}</p>
                              <p className="font-['Manrope'] text-xs text-[#4e4639]/70 mt-0.5">{SHIFT_LABELS[s]}</p>
                            </div>
                            <span className="font-['Manrope'] text-[10px] uppercase tracking-widest text-[#4e4639]">
                              {notes.length} {notes.length === 1 ? 'note' : 'notes'}
                            </span>
                          </div>
                          {notes.length === 0 ? (
                            <p className="font-['Manrope'] text-sm text-[#4e4639]/60 italic">No notes for this shift yet.</p>
                          ) : (
                            <div className="space-y-3">
                              {notes.slice(0, 5).map((note) => (
                                <div key={note.id} className="bg-[#f4f3f1] rounded-[18px] p-4">
                                  <p className="font-['Manrope'] text-sm text-[#1a1c1b] leading-6">{note.note}</p>
                                  <div className="mt-2 flex items-center justify-between">
                                    <span className="font-['Manrope'] text-[10px] text-[#4e4639] font-semibold">{note.authorName}</span>
                                    <div className="flex items-center justify-end gap-2">
                                      <span className="font-['Manrope'] text-[10px] text-[#4e4639]/70">
                                        {note.createdAt ? note.createdAt.toLocaleString() : '—'}
                                      </span>
                                      {identity.role === 'manager' ? (
                                        <button
                                          className="text-[#ba1a1a] font-['Manrope'] text-[10px] uppercase tracking-widest hover:bg-[#ffdad6] px-2 py-1 rounded transition-colors"
                                          disabled={busyActionId === `delete-note-${note.id}`}
                                          onClick={() => deleteShiftNote(note)}
                                          type="button"
                                        >
                                          {busyActionId === `delete-note-${note.id}` ? 'Deleting...' : 'Delete'}
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {/* ══════════════════════════════════════════
                SETTINGS
            ══════════════════════════════════════════ */}
            {activeTab === 'settings' ? (
              <div className="admin-page admin-page-settings">
                <div className="mb-16 flex justify-between items-end gap-6">
                  <div>
                    <h2 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] tracking-tight font-semibold">General Settings</h2>
                    <p className="font-['Manrope'] text-[#5f5e5e] mt-2 text-sm">Configure core operational parameters for in-room dining.</p>
                  </div>
                  <button
                    className="ml-auto shrink-0 bg-[#775a19] text-white px-8 py-3.5 rounded-full shadow-[0_8px_24px_rgba(119,90,25,0.3)] hover:bg-[#775a19]/90 transition-colors font-['Manrope'] text-sm font-semibold tracking-wide disabled:opacity-50 flex items-center gap-2"
                    disabled={isSavingSettings}
                    onClick={saveSettingsDraft}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[18px]">save</span>
                    {isSavingSettings ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12">
                  <section className="lg:col-span-8 bg-white p-8 rounded-lg outline outline-1 outline-[#d1c5b4]/20 shadow-[0_20px_40px_rgba(26,28,27,0.03)]">
                    <div className="mb-8 flex items-center gap-3 border-b border-[#f4f3f1] pb-4">
                      <span className="material-symbols-outlined text-[#c5a059]" style={{ fontVariationSettings: "'FILL' 1" }}>schedule</span>
                      <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">Operating Hours</h3>
                    </div>
                    <div className="space-y-4">
                      {operatingHours.map((row) => (
                        <div key={row.day} className="admin-hours-row">
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(e) => setOperatingHours((current) => current.map((item) => (
                              item.day === row.day ? { ...item, enabled: e.target.checked } : item
                            )))}
                            className="h-5 w-5 accent-[#775a19]"
                          />
                          <span className="admin-hours-day font-['Manrope'] text-sm text-[#1a1c1b]">{row.day}</span>
                          <input
                            type="time"
                            value={row.opensAt}
                            onChange={(e) => setOperatingHours((current) => current.map((item) => (
                              item.day === row.day ? { ...item, opensAt: e.target.value } : item
                            )))}
                            className="admin-hours-input w-full bg-[#e9e8e6] px-3 py-2.5 text-center text-sm text-[#1a1c1b] outline-none border-b border-[#775a19]"
                          />
                          <span className="admin-hours-separator text-sm text-[#5f5e5e] text-center">–</span>
                          <input
                            type="time"
                            value={row.closesAt}
                            onChange={(e) => setOperatingHours((current) => current.map((item) => (
                              item.day === row.day ? { ...item, closesAt: e.target.value } : item
                            )))}
                            className="admin-hours-input w-full bg-[#e9e8e6] px-3 py-2.5 text-center text-sm text-[#1a1c1b] outline-none border-b border-[#775a19]"
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="lg:col-span-4 bg-[#f4f3f1] p-8 rounded-lg outline outline-1 outline-[#d1c5b4]/20 flex flex-col">
                    <div className="mb-8 flex items-center gap-3">
                      <span className="material-symbols-outlined text-[#775a19]" style={{ fontVariationSettings: "'FILL' 1" }}>account_balance</span>
                      <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">Financials</h3>
                    </div>
                    <div className="space-y-8 flex-1">
                      <div>
                        <label className="mb-3 block font-['Manrope'] text-xs uppercase tracking-widest text-[#4e4639]">Base Tax Rate (%)</label>
                        <input
                          type="number"
                          value={taxRate}
                          onChange={(e) => setTaxRate(e.target.value)}
                          step="0.1"
                          placeholder="Set tax rate"
                          className="w-full bg-[#e3e2e0] border-none border-b border-transparent px-4 py-3 font-mono text-lg text-[#1a1c1b] outline-none focus:border-b focus:border-[#775a19] rounded-t transition-all"
                        />
                      </div>
                      <div>
                        <label className="mb-3 block font-['Manrope'] text-xs uppercase tracking-widest text-[#4e4639]">In-Room Dining Surcharge (%)</label>
                        <input
                          type="number"
                          value={surchargeRate}
                          onChange={(e) => setSurchargeRate(e.target.value)}
                          step="0.1"
                          placeholder="Set surcharge"
                          className="w-full bg-[#e3e2e0] border-none border-b border-transparent px-4 py-3 font-mono text-lg text-[#1a1c1b] outline-none focus:border-b focus:border-[#775a19] rounded-t transition-all"
                        />
                        <p className="mt-2 font-['Manrope'] text-xs text-[#4e4639] opacity-75">Automatically applied to subtotal before tax.</p>
                      </div>
                    </div>
                  </section>
                </div>

                <section className="bg-white p-8 rounded-lg outline outline-1 outline-[#d1c5b4]/20 shadow-[0_20px_40px_rgba(26,28,27,0.03)] mb-12 mt-4">
                  <div className="flex flex-col md:flex-row md:items-start gap-12">
                    <div className="md:w-1/3">
                      <div className="mb-4 flex items-center gap-3">
                        <span className="material-symbols-outlined text-[#c5a059]" style={{ fontVariationSettings: "'FILL' 1" }}>notifications_active</span>
                        <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">Alert Preferences</h3>
                      </div>
                      <p className="font-['Manrope'] text-sm text-[#4e4639] leading-relaxed">
                        Manage how and when staff are notified of new orders, delays, or guest feedback.
                      </p>
                    </div>
                    <div className="md:w-2/3 grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                      {alertPreferences.map((preference) => (
                        <div key={preference.id} className="flex items-start justify-between">
                          <div>
                            <p className="font-['Manrope'] font-medium text-[#1a1c1b]">{preference.title}</p>
                            <p className="font-['Manrope'] text-xs text-[#4e4639] mt-1">{preference.copy}</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={preference.enabled}
                            onChange={(e) => setAlertPreferences((current) => current.map((item) => (
                              item.id === preference.id ? { ...item, enabled: e.target.checked } : item
                            )))}
                            className="mt-1 h-5 w-5 accent-[#775a19] shrink-0"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-6">
                    <ManagerOnly role={identity.role}>
                      <section className={`${ELEVATED_PANEL_CLASS} p-8`}>
                        <div className="mb-6 flex items-center justify-between gap-4">
                          <div>
                            <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#5f5e5e]">Manager Controls</p>
                            <h3 className="mt-2 font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Team Access</h3>
                          </div>
                          <button type="button" onClick={() => setStaffEditor(getStaffEditorState())} className="rounded-[14px] bg-[#775a19] px-5 py-3 font-['Manrope'] text-xs font-semibold uppercase tracking-[0.16em] text-white">
                            Add Staff
                          </button>
                        </div>
                        {teamStatus ? <p className="mb-4 text-sm text-[#775a19]">{teamStatus}</p> : null}
                        <div className="space-y-4">
                          {visibleStaffAccounts.map((staff) => (
                            <div key={staff.uid} className="rounded-[18px] bg-[#f4f3f1] p-5">
                              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                <div>
                                  <div className="flex items-center gap-3">
                                    <h4 className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">{staff.name}</h4>
                                    <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.16em] ${staff.active ? 'bg-[#e9c176]/30 text-[#5d4201]' : 'bg-[#ffdad6] text-[#93000a]'}`}>
                                      {staff.active ? staff.role : 'inactive'}
                                    </span>
                                  </div>
                                  <p className="mt-2 font-['Manrope'] text-sm text-[#4e4639]">{staff.username} · {staff.email || 'No email set'}</p>
                                  <p className="mt-1 font-['Manrope'] text-xs text-[#5f5e5e]">
                                    Last updated {staff.lastUpdatedAt ? staff.lastUpdatedAt.toLocaleString() : 'not recorded'}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button type="button" onClick={() => setStaffEditor(getStaffEditorState(staff))} className="rounded-[14px] border border-[#d1c5b4]/50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#4e4639]">
                                    Edit
                                  </button>
                                  <button type="button" onClick={() => setStaffEditor({ ...getStaffEditorState(staff), password: '' })} className="rounded-[14px] border border-[#d1c5b4]/50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#775a19]">
                                    Reset Pass
                                  </button>
                                  <button type="button" onClick={() => removeStaffAccount(staff.uid)} className="rounded-[14px] border border-[#ba1a1a]/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#ba1a1a]">
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                          {visibleStaffAccounts.length === 0 ? <p className="text-sm text-[#4e4639]">No staff accounts found.</p> : null}
                        </div>
                      </section>
                    </ManagerOnly>

                  </div>

                  <div className="space-y-6">
                    <section className={`${ELEVATED_PANEL_CLASS} p-7`}>
                      <div className="mb-5 flex items-center gap-3">
                        <span className="material-symbols-outlined text-[#775a19] text-[22px]">manage_accounts</span>
                        <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">Active Operator</h3>
                      </div>
                      <div className="space-y-0">
                        {[
                          { label: 'Name', value: identity.name },
                          { label: 'Role', value: identity.role },
                          { label: 'Credential', value: identity.username },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex justify-between items-center py-3 border-b border-[#f4f3f1] last:border-0">
                            <span className="font-['Manrope'] text-xs uppercase tracking-widest text-[#4e4639] font-semibold">{label}</span>
                            <span className="font-['Manrope'] text-sm text-[#1a1c1b] font-medium">{value}</span>
                          </div>
                        ))}
                      </div>
                      <button className="mt-5 w-full rounded-[14px] border border-[#d1c5b4]/50 py-3 font-['Manrope'] text-xs uppercase tracking-widest text-[#775a19]" onClick={handleLogout} type="button">
                        Sign Out
                      </button>
                    </section>
                    <section className={`${ELEVATED_PANEL_CLASS} p-7`}>
                      <div className="mb-5 flex items-center gap-3">
                        <span className="material-symbols-outlined text-[#775a19] text-[22px]">policy</span>
                        <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">Audit Trail</h3>
                      </div>
                      <p className="font-['Manrope'] text-sm leading-6 text-[#4e4639]">
                        Every write action is logged to <code className="rounded bg-[#f4f3f1] px-1.5 py-0.5 text-xs text-[#1a1c1b]">auditLog</code> with operator name, role, and timestamp.
                      </p>
                    </section>
                  </div>
                </div>
              </div>
            ) : null}

          </div>
        </main>

      {/* ── Menu editor modal ── */}
      {editingProduct ? (
        <div className="admin-modal-backdrop fixed inset-0 z-[55] flex items-center justify-center p-4" onClick={() => setEditingProduct(null)}>
          <div className="admin-menu-modal w-full max-w-2xl bg-white rounded-lg shadow-[0_20px_60px_rgba(26,28,27,0.2)] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="admin-menu-modal-header p-6 border-b border-[#f4f3f1] flex items-start justify-between gap-4">
              <div>
                <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold">Menu Editor</p>
                <h3 className="font-['Noto_Serif'] text-2xl text-[#1a1c1b] mt-1">
                  {editingProduct.id ? 'Edit Menu Item' : 'Add Menu Item'}
                </h3>
              </div>
              <button
                className="border border-[#d1c5b4]/50 text-[#4e4639] font-['Manrope'] text-xs uppercase tracking-widest px-3 py-1.5 rounded hover:bg-[#f4f3f1] transition-colors shrink-0"
                onClick={() => setEditingProduct(null)} type="button"
              >
                Close
              </button>
            </div>
            <div className="admin-menu-modal-body p-6 grid gap-5 md:grid-cols-2">
              {([
                { label: 'Item Name', key: 'name' as const },
                { label: 'Category', key: 'category' as const },
                { label: 'Price', key: 'price' as const },
              ] as { label: string; key: keyof MenuEditorState }[]).map((field) => (
                <UnderlineInput
                  key={field.key} id={field.key} label={field.label}
                  value={String(editingProduct[field.key])}
                  onChange={(v) => setEditingProduct((c) => c ? { ...c, [field.key]: v } : c)}
                />
              ))}
              <div>
                <UnderlineInput
                  id="image"
                  label="Image URL"
                  value={editingProduct.image}
                  placeholder="Paste image URL or choose from device"
                  onChange={(v) => setEditingProduct((c) => c ? { ...c, image: v } : c)}
                />
              </div>
              <div>
                <label className="block font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold mb-2">Upload Image</label>
                <button
                  className="admin-menu-upload-button"
                  disabled={isProcessingMenuImage}
                  onClick={openMenuImagePicker}
                  type="button"
                >
                  <span className="admin-menu-upload-icon material-symbols-outlined">add_photo_alternate</span>
                  <span className="admin-menu-upload-copy">
                    <span>{isProcessingMenuImage ? 'Processing photo...' : 'Choose Food Photo'}</span>
                    <small>{Capacitor.isNativePlatform() ? 'Uses native iPad Photos picker' : 'Works with browser file upload'}</small>
                  </span>
                  <span className="material-symbols-outlined text-[20px] text-[#775a19]">chevron_right</span>
                </button>
                <input
                  ref={menuImageInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={isProcessingMenuImage}
                  onChange={(e) => {
                    handleMenuImageUpload(e.target.files?.[0]);
                    e.currentTarget.value = '';
                  }}
                />
                <p className="mt-2 font-['Manrope'] text-[11px] leading-5 text-[#4e4639]/70">Images are compressed before save so the same asset works on web, iPad, and Android tablet.</p>
              </div>
              {editingProduct.image?.trim() ? (
                <div className="md:col-span-2">
                  <label className="block font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold mb-2">Image Preview</label>
                  <div className="h-32 w-32 rounded-lg overflow-hidden bg-[#e9e8e6] border border-[#d1c5b4]/30">
                    <img src={editingProduct.image} alt="Preview" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                </div>
              ) : null}
              <div className="md:col-span-2">
                <label className="block font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold mb-2">Description</label>
                <textarea
                  className="w-full bg-[#f4f3f1] border-none rounded px-4 py-3 font-['Manrope'] text-sm text-[#1a1c1b] outline-none resize-none min-h-[100px]"
                  value={editingProduct.description}
                  onChange={(e) => setEditingProduct((c) => c ? { ...c, description: e.target.value } : c)}
                />
              </div>
              <div className="md:col-span-2">
                <UnderlineInput
                  id="unavailableReason" label="Unavailable Reason"
                  value={editingProduct.unavailableReason}
                  placeholder="Kitchen prep exhausted for this shift"
                  onChange={(v) => setEditingProduct((c) => c ? { ...c, unavailableReason: v } : c)}
                />
              </div>
              <button
                aria-checked={editingProduct.isAvailable}
                className={`admin-menu-editor-availability md:col-span-2 ${editingProduct.isAvailable ? 'is-on' : 'is-off'}`}
                onClick={() => setEditingProduct((c) => c ? { ...c, isAvailable: !c.isAvailable } : c)}
                role="switch"
                type="button"
              >
                <span className="admin-menu-editor-availability-copy">
                  <strong>{editingProduct.isAvailable ? 'Available for guests' : 'Hidden from guests'}</strong>
                  <span>{editingProduct.isAvailable ? 'ON: item can be ordered now.' : 'OFF: item remains saved but cannot be ordered.'}</span>
                </span>
                <span className="admin-menu-editor-availability-control">
                  <span>{editingProduct.isAvailable ? 'ON' : 'OFF'}</span>
                  <span className="admin-menu-editor-availability-track">
                    <span />
                  </span>
                </span>
              </button>
            </div>
            <div className="admin-menu-modal-footer px-6 pb-6 flex flex-wrap gap-3">
              <button
                className="bg-[#775a19] text-white font-['Manrope'] text-xs uppercase tracking-widest font-semibold px-5 py-3 rounded hover:bg-[#775a19]/90 transition-colors shadow-[0_4px_14px_rgba(119,90,25,0.2)]"
                disabled={isSavingProduct || isProcessingMenuImage}
                onClick={() => saveProduct(editingProduct)} type="button"
              >
                {isSavingProduct ? 'Saving...' : isProcessingMenuImage ? 'Processing...' : 'Save Item'}
              </button>
              <button
                className="border border-[#d1c5b4]/50 text-[#4e4639] font-['Manrope'] text-xs uppercase tracking-widest font-semibold px-5 py-3 rounded hover:bg-[#f4f3f1] transition-colors"
                onClick={() => setEditingProduct(null)} type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {staffEditor ? (
        <div className="admin-modal-backdrop fixed inset-0 z-[55] flex items-center justify-center p-4" onClick={() => setStaffEditor(null)}>
          <div className="admin-staff-modal w-full max-w-2xl rounded-[22px] bg-white shadow-[0_20px_60px_rgba(26,28,27,0.2)] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="admin-menu-modal-header flex items-start justify-between gap-4 border-b border-[#f4f3f1] p-6">
              <div>
                <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold">Manager Controls</p>
                <h3 className="mt-1 font-['Noto_Serif'] text-2xl text-[#1a1c1b]">
                  {staffEditor.uid ? 'Update Staff Access' : 'Add Staff Access'}
                </h3>
              </div>
              <button className="rounded border border-[#d1c5b4]/50 px-3 py-1.5 font-['Manrope'] text-xs uppercase tracking-widest text-[#4e4639]" onClick={() => setStaffEditor(null)} type="button">
                Close
              </button>
            </div>
            <div className="admin-menu-modal-body grid gap-5 p-6 md:grid-cols-2">
              {!hotelId.trim() ? (
                <div className="md:col-span-2 rounded-[16px] border border-[#ba1a1a]/20 bg-[#ffdad6]/45 px-4 py-3 font-['Manrope'] text-sm text-[#93000a]">
                  Set Hotel ID in Settings before creating staff access.
                </div>
              ) : null}
              <UnderlineInput id="staff-name" label="Full Name" value={staffEditor.name} onChange={(v) => setStaffEditor((current) => current ? { ...current, name: v } : current)} />
              <UnderlineInput id="staff-username" label="Username" value={staffEditor.username} onChange={(v) => setStaffEditor((current) => current ? { ...current, username: v } : current)} />
              <UnderlineInput id="staff-email" label="Email" value={staffEditor.email} onChange={(v) => setStaffEditor((current) => current ? { ...current, email: v } : current)} />
              <div>
                <label className="mb-2 block font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold">Role</label>
                <select
                  value={staffEditor.role}
                  onChange={(e) => setStaffEditor((current) => current ? { ...current, role: normalizeRole(e.target.value) } : current)}
                  className="w-full rounded-[14px] bg-[#f4f3f1] px-4 py-3 text-sm text-[#1a1c1b] outline-none"
                >
                  <option value="staff">Staff</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <UnderlineInput
                  id="staff-password"
                  label={staffEditor.uid ? 'New Password' : 'Temporary Password'}
                  type="password"
                  value={staffEditor.password}
                  onChange={(v) => setStaffEditor((current) => current ? { ...current, password: v } : current)}
                />
                <p className="mt-2 text-xs text-[#5f5e5e]">
                  {staffEditor.uid ? 'Leave blank to keep the current password.' : 'Manager sets the initial password for this account.'}
                </p>
              </div>
              <label className="md:col-span-2 flex items-center gap-3 rounded-[18px] bg-[#f4f3f1] px-4 py-3 font-['Manrope'] text-sm text-[#1a1c1b]">
                <input
                  type="checkbox"
                  checked={staffEditor.active}
                  onChange={(e) => setStaffEditor((current) => current ? { ...current, active: e.target.checked } : current)}
                  className="h-4 w-4 accent-[#775a19]"
                />
                Active access
              </label>
            </div>
            <div className="admin-staff-modal-footer flex flex-wrap gap-3 px-6 pb-6">
              <button
                type="button"
                disabled={isSavingStaff || !hotelId.trim() || !staffEditor.name.trim() || !staffEditor.username.trim() || !staffEditor.email.trim() || (!staffEditor.uid && !staffEditor.password.trim())}
                onClick={() => saveStaffAccount(staffEditor)}
                className="rounded-[14px] bg-[#775a19] px-5 py-3 font-['Manrope'] text-xs font-semibold uppercase tracking-[0.16em] text-white disabled:opacity-50"
              >
                {isSavingStaff ? 'Saving…' : staffEditor.uid ? 'Save Access' : 'Create Staff'}
              </button>
              {staffEditor.uid ? (
                <button
                  type="button"
                  disabled={passwordResetUid === staffEditor.uid || !staffEditor.password.trim()}
                  onClick={() => resetStaffPassword(staffEditor.uid as string, staffEditor.password)}
                  className="rounded-[14px] border border-[#d1c5b4]/50 px-5 py-3 font-['Manrope'] text-xs font-semibold uppercase tracking-[0.16em] text-[#775a19] disabled:opacity-50"
                >
                  {passwordResetUid === staffEditor.uid ? 'Updating…' : 'Update Password'}
                </button>
              ) : null}
              <button type="button" onClick={() => setStaffEditor(null)} className="rounded-[14px] border border-[#d1c5b4]/50 px-5 py-3 font-['Manrope'] text-xs font-semibold uppercase tracking-[0.16em] text-[#4e4639]">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmDialog ? (
        <div
          className="admin-modal-backdrop admin-confirm-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4"
          onClick={() => { if (!isConfirmingDialog) setConfirmDialog(null); }}
        >
          <div className="admin-confirm-modal w-full max-w-sm rounded-2xl bg-white shadow-[0_20px_60px_rgba(26,28,27,0.24)] p-7" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title">
            <div className="admin-confirm-header flex items-center gap-3 mb-4">
              <span className="admin-confirm-icon material-symbols-outlined text-[#ba1a1a] text-[22px]">{confirmDialog.icon || 'warning'}</span>
              <div>
                <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#ba1a1a]">Manager confirmation</p>
                <h3 id="admin-confirm-title" className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">{confirmDialog.title}</h3>
              </div>
            </div>
            <div className="admin-confirm-copy">
              <p className="font-['Manrope'] text-sm font-semibold text-[#1a1c1b] leading-relaxed">{confirmDialog.message}</p>
              {confirmDialog.detail ? (
                <p className="mt-3 font-['Manrope'] text-sm text-[#4e4639] leading-relaxed">{confirmDialog.detail}</p>
              ) : null}
            </div>
            <div className="admin-confirm-actions flex gap-3 justify-end">
              <button
                type="button"
                className="admin-confirm-cancel rounded-[14px] border border-[#d1c5b4]/50 px-5 py-2.5 font-['Manrope'] text-xs font-semibold uppercase tracking-[0.16em] text-[#4e4639] hover:bg-[#f4f3f1] transition-colors"
                disabled={isConfirmingDialog}
                onClick={() => setConfirmDialog(null)}
              >
                {confirmDialog.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                className="admin-confirm-execute rounded-[14px] bg-[#ba1a1a] px-5 py-2.5 font-['Manrope'] text-xs font-semibold uppercase tracking-[0.16em] text-white hover:bg-[#93000a] transition-colors shadow-[0_8px_16px_rgba(186,26,26,0.2)]"
                disabled={isConfirmingDialog}
                onClick={executeConfirmDialogAction}
              >
                {isConfirmingDialog ? 'Processing...' : confirmDialog.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
