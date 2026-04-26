import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, db } from '../../lib/firebase';
import { createGuestQrToken, revokeGuestSessionAsAdmin } from '../../lib/adminAccess';
import {
  createAdminUser,
  deleteAdminUser,
  updateAdminPassword,
  updateAdminProfile,
} from '../../lib/adminTeam';
import { useDynamicTitle } from '../../hooks/useDynamicTitle';
import { useWakeLock } from '../../hooks/useWakeLock';
import { getNewIncomingOrderIds } from '../../admin/notifications';
import { buildRevenueExport } from '../../admin/revenue';
import { resolveAdminSession, type AdminRole } from '../../admin/session';

type AdminTab = 'orders' | 'menu' | 'feedback' | 'revenue' | 'handover' | 'settings';
type ShiftName = 'morning' | 'afternoon' | 'night';

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

const TERMINAL_STATUSES = new Set(['delivered', 'completed', 'cancelled']);
const SLA_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

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

const TAB_SEARCH_PLACEHOLDERS: Record<AdminTab, string> = {
  orders: 'Search orders...',
  menu: 'Search menu...',
  feedback: 'Search feedback...',
  revenue: 'Search revenue...',
  handover: 'Search notes...',
  settings: 'Search settings...',
};

const ELEVATED_PANEL_CLASS = 'rounded-[22px] bg-white/96 ring-1 ring-[#efe8de] shadow-[0_24px_55px_rgba(26,28,27,0.05)] backdrop-blur-sm';
const TONAL_PANEL_CLASS = 'rounded-[22px] bg-[#f4f3f1]/96 ring-1 ring-[#ebe5dc] shadow-[0_20px_45px_rgba(26,28,27,0.04)]';

function normalizeRole(role: unknown): AdminRole {
  return role === 'staff' ? 'staff' : 'manager';
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
      return { label: 'Accept Order', nextStatus: 'confirmed' };
    case 'confirmed':
      return { label: 'Send to Kitchen', nextStatus: 'kitchen' };
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
  if (!order.createdAt || TERMINAL_STATUSES.has(order.status)) return false;
  return Date.now() - order.createdAt.getTime() > SLA_THRESHOLD_MS;
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
    roomNumber: typeof data.roomNumber === 'string' ? data.roomNumber : 'Unknown',
    lastName: typeof data.lastName === 'string' ? data.lastName : '',
    phoneNumber: typeof data.phoneNumber === 'string' ? data.phoneNumber : '',
    status: typeof data.status === 'string' ? data.status : 'incoming',
    items: rawItems.map((item, index) => {
      const row = (item && typeof item === 'object') ? item as Record<string, unknown> : {};
      return {
        id: typeof row.id === 'string' ? row.id : `${docId}-${index}`,
        name: typeof row.name === 'string' ? row.name : 'Unknown item',
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

  // UI state
  const [shellSearch, setShellSearch] = useState('');
  const [editingProduct, setEditingProduct] = useState<MenuEditorState | null>(null);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | '5' | '4' | 'week'>('all');
  const [revenueRange, setRevenueRange] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  // Settings / QR
  const [hotelId, setHotelId] = useState('atelier-meridian-demo');
  const [stayId, setStayId] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState('720');
  const [tokenResult, setTokenResult] = useState<{ qrUrl: string; rawToken: string; expiresAt: string } | null>(null);
  const [tokenStatus, setTokenStatus] = useState('');
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [teamStatus, setTeamStatus] = useState('');
  const [staffEditor, setStaffEditor] = useState<StaffEditorState | null>(null);
  const [isSavingStaff, setIsSavingStaff] = useState(false);
  const [passwordResetUid, setPasswordResetUid] = useState<string | null>(null);

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
    () => orders.filter((o) => !TERMINAL_STATUSES.has(o.status)),
    [orders],
  );
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
  const revenueRows = useMemo(
    () => orders
      .filter((order) => ['delivered', 'completed'].includes(order.status))
      .filter((order) => isWithinRange(order.createdAt, revenuePeriodBounds.currentStart, revenuePeriodBounds.currentEnd))
      .map((order) => ({
        id: order.id,
        roomNumber: order.roomNumber,
        paymentMethod: order.paymentMethod,
        total: order.total,
        createdAt: order.createdAt as Date,
      })),
    [orders, revenuePeriodBounds],
  );
  const previousRevenueRows = useMemo(
    () => orders
      .filter((order) => ['delivered', 'completed'].includes(order.status))
      .filter((order) => isWithinRange(order.createdAt, revenuePeriodBounds.previousStart, revenuePeriodBounds.previousEnd))
      .map((order) => ({
        id: order.id,
        roomNumber: order.roomNumber,
        paymentMethod: order.paymentMethod,
        total: order.total,
        createdAt: order.createdAt as Date,
      })),
    [orders, revenuePeriodBounds],
  );
  const revenueSummary = useMemo(() => ({
    kpi: {
      revenue: revenueRows.reduce((sum, row) => sum + row.total, 0),
      completedOrders: revenueRows.length,
      cancelledOrders: orders.filter(
        (order) => order.status === 'cancelled'
          && isWithinRange(order.createdAt, revenuePeriodBounds.currentStart, revenuePeriodBounds.currentEnd),
      ).length,
    },
    rows: revenueRows,
  }), [orders, revenuePeriodBounds, revenueRows]);
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
        const value = orders
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
      const value = orders
        .filter((order) => ['delivered', 'completed'].includes(order.status))
        .filter((order) => isWithinRange(order.createdAt, bucketStart, bucketEnd))
        .reduce((sum, order) => sum + order.total, 0);
      const label = bucketStart.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      return { label, value };
    });
  }, [orders, revenueAnchorDate, revenuePeriodBounds.currentStart, revenueRange]);
  const revenueLeaders = useMemo<RevenueMenuLeader[]>(() => {
    const completedOrders = orders.filter((order) => (
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
  }, [orders, products, revenuePeriodBounds]);
  const revenueDistribution = useMemo<RevenueSegment[]>(() => {
    const completedOrders = orders.filter((order) => (
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
  }, [orders, revenuePeriodBounds]);
  const visibleOrders = useMemo(() => {
    const queryText = '';
    return activeOrders.filter((order) => {
      if (!queryText) return true;
      return [
        order.roomNumber,
        order.lastName,
        order.status,
        ...order.items.map((item) => item.name),
      ].some((value) => value.toLowerCase().includes(queryText));
    });
  }, [activeOrders]);
  const visibleStaffAccounts = useMemo(() => {
    const queryText = (activeTab === 'settings' ? shellSearch : '').trim().toLowerCase();
    if (!queryText) return staffAccounts;
    return staffAccounts.filter((staff) => (
      [staff.name, staff.email, staff.username, staff.role].some((value) => value.toLowerCase().includes(queryText))
    ));
  }, [activeTab, shellSearch, staffAccounts]);
  const shiftNotesByShift = useMemo(() => {
    const out: Record<ShiftName, ShiftNote[]> = { morning: [], afternoon: [], night: [] };
    for (const n of shiftNotes) out[n.shift].push(n);
    return out;
  }, [shiftNotes]);
  const filteredFeedbackOrders = useMemo(() => {
    const queryText = feedbackSearch.trim().toLowerCase();
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
  }, [feedbackFilter, feedbackOrders, feedbackSearch]);
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

  /* ── Auth ── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
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
    return () => unsub();
  }, []);

  /* ── Firestore subscriptions ── */
  useEffect(() => {
    if (!identity) { setOrders([]); setProducts([]); setShiftNotes([]); setStaffAccounts([]); return; }

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
      },
    );

    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map((d) => normalizeProduct(d.id, d.data() as Record<string, unknown>)));
    });

    const unsubNotes = onSnapshot(
      query(collection(db, 'shiftNotes'), orderBy('createdAt', 'desc'), limit(60)),
      (snap) => {
        setShiftNotes(snap.docs.map((d) => normalizeShiftNote(d.id, d.data() as Record<string, unknown>)));
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
      hotelId: String(profile?.hotelId || 'atelier-meridian-demo'),
      username: String(profile?.username || profile?.email || session.email),
    };
  }

  /* Audit trail — writes one doc to auditLog for every staff action */
  async function logAudit(
    action: string,
    targetType: 'order' | 'product' | 'guestSession' | 'shiftNote',
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

  /* ── Write handlers ── */
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setIsLoggingIn(true);
    try {
      await signInWithEmailAndPassword(auth, loginForm.credential.trim(), loginForm.password);
    } catch (err) {
      console.error('Admin login failed', err);
      setAuthError('Login gagal. Gunakan akun manager atau staff yang aktif di Firebase Auth.');
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleLogout() {
    await signOut(auth);
    setIdentity(null);
  }

  async function updateOrderStatus(orderId: string, status: string) {
    const prev = orders.find((o) => o.id === orderId)?.status;
    await updateDoc(doc(db, 'orders', orderId), { status, isRead: true, updatedAt: serverTimestamp() });
    await logAudit('status_change', 'order', orderId, { from: prev, to: status });
  }

  async function markAsRead(orderId: string) {
    await updateDoc(doc(db, 'orders', orderId), { isRead: true, updatedAt: serverTimestamp() });
    await logAudit('mark_read', 'order', orderId);
  }

  async function toggleProductAvailability(product: MenuProduct) {
    const next = !product.isAvailable;
    await updateDoc(doc(db, 'products', product.id), {
      isAvailable: next,
      unavailableReason: next ? '' : (product.unavailableReason || 'Temporarily unavailable'),
      updatedAt: serverTimestamp(),
    });
    await logAudit(next ? 'set_available' : 'set_unavailable', 'product', product.id, { name: product.name });
  }

  async function saveProduct(editor: MenuEditorState) {
    const payload = {
      name: editor.name.trim(), category: editor.category.trim(),
      price: Number(editor.price) || 0, description: editor.description.trim(),
      image: editor.image.trim(), isAvailable: editor.isAvailable,
      unavailableReason: editor.unavailableReason.trim(), updatedAt: serverTimestamp(),
    };
    if (editor.id) {
      await updateDoc(doc(db, 'products', editor.id), payload);
      await logAudit('edit_product', 'product', editor.id, { name: editor.name });
    } else {
      const ref = await addDoc(collection(db, 'products'), { ...payload, createdAt: serverTimestamp() });
      await logAudit('add_product', 'product', ref.id, { name: editor.name });
    }
    setEditingProduct(null);
  }

  async function deleteProduct(productId: string) {
    const product = products.find((p) => p.id === productId);
    await deleteDoc(doc(db, 'products', productId));
    await logAudit('delete_product', 'product', productId, { name: product?.name });
  }

  async function handleGenerateQr() {
    if (!hotelId.trim() || !stayId.trim() || !roomNumber.trim()) {
      setTokenStatus('Hotel ID, stay ID, and room number are required.');
      return;
    }
    setIsGeneratingToken(true);
    setTokenStatus('');
    try {
      const result = await createGuestQrToken({
        hotelId: hotelId.trim(), stayId: stayId.trim(), roomNumber: roomNumber.trim(),
        baseUrl: window.location.origin, expiresInMinutes: Number(expiresInMinutes) || 720,
      });
      setTokenResult(result);
      setTokenStatus('Guest QR generated. Copy the URL into the print or front-office workflow.');
    } catch (err) {
      console.error('Failed to create guest QR token', err);
      setTokenStatus('Failed to create QR token.');
    } finally {
      setIsGeneratingToken(false);
    }
  }

  async function copyTokenUrl() {
    if (!tokenResult?.qrUrl) return;
    await navigator.clipboard.writeText(tokenResult.qrUrl);
    setTokenStatus('Guest QR URL copied to clipboard.');
  }

  async function handleRevokeGuest(guestUid: string) {
    setRevokingSessionId(guestUid);
    try {
      await revokeGuestSessionAsAdmin(guestUid);
      await logAudit('revoke_guest_session', 'guestSession', guestUid);
    } finally {
      setRevokingSessionId(null);
    }
  }

  function exportRevenue() {
    const exp = buildRevenueExport(revenueSummary.rows, new Date(`${selectedDate}T12:00:00`));
    downloadExcelFile(exp.filename, exp.mimeType, exp.content);
  }

  async function saveHandoverNote() {
    if (!handoverDraft.trim() || !identity) return;
    setIsSavingNote(true);
    try {
      const ref = await addDoc(collection(db, 'shiftNotes'), {
        shift: activeShift,
        note: handoverDraft.trim(),
        authorName: identity.name,
        authorUid: identity.uid,
        createdAt: serverTimestamp(),
      });
      await logAudit('add_shift_note', 'shiftNote', ref.id, { shift: activeShift });
      setHandoverDraft('');
    } finally {
      setIsSavingNote(false);
    }
  }

  async function saveStaffAccount(editor: StaffEditorState) {
    if (!identity) return;
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

  async function removeStaffAccount(uid: string) {
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

  if (!authReady) return <div className="min-h-screen bg-[#faf9f7]" />;

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
                <span>© 2025 Atelier Meridian</span>
                <div style={{ display: 'flex', gap: '1.25rem' }}>
                  {['Privacy', 'Support'].map((link) => (
                    <button key={link} type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', padding: 0 }}>
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
    <div
      className="min-h-screen bg-[#faf9f7]"
      style={{
        fontFamily: "'Manrope', sans-serif",
        color: '#1a1c1b',
        backgroundImage: 'radial-gradient(circle at top right, rgba(197,160,89,0.10), transparent 24%), radial-gradient(circle at left center, rgba(244,243,241,0.95), transparent 28%)',
      }}
    >
      <div className="flex min-h-screen">

        {/* ── Sidebar ── */}
        <aside className="hidden lg:flex fixed left-0 top-0 h-full w-[17rem] flex-col bg-[#f4f3f1]/92 py-8 z-50 backdrop-blur-sm">
          <div className="px-8 mb-10">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 overflow-hidden rounded-full bg-[#e3e2e0] shadow-[0_12px_24px_rgba(26,28,27,0.08)] ring-1 ring-white/70">
                <img src={BRAND_LOGO_URL} alt="Atelier Meridian logo" className="h-full w-full object-cover" />
              </div>
              <div>
                <h1 className="font-['Noto_Serif'] text-[2rem] leading-none tracking-[-0.03em] text-[#7d2f12]">Atelier Meridian</h1>
                <p className="mt-1 font-['Manrope'] text-sm tracking-wide text-[#4e4639]">In-Room Dining Admin</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto">
            <ul className="space-y-2 pr-3">
              {navItems.map(({ id, label, icon, badge }) => {
                const isActive = activeTab === id;
                return (
                  <li key={id}>
                    <button
                      className={`flex w-full items-center justify-between py-4 pl-8 pr-5 text-left transition-all duration-200 font-['Manrope'] text-sm font-medium tracking-wide ${
                        isActive
                          ? 'bg-white text-[#8b300f] rounded-r-2xl rounded-l-none font-bold shadow-[0_18px_36px_rgba(26,28,27,0.07)]'
                          : 'text-[#4e4639] hover:bg-white/55 rounded-r-2xl'
                      }`}
                      onClick={() => setActiveTab(id)}
                      type="button"
                    >
                      <span className="flex items-center gap-4">
                        <span
                          className={`material-symbols-outlined text-[20px] ${isActive ? 'text-[#a44615]' : 'text-[#a44615]'}`}
                          style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                        >
                          {icon}
                        </span>
                        {label}
                      </span>
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
              className="w-full py-3 px-4 rounded-[14px] border border-[#e2d8cb] bg-white/70 text-[#8d6214] font-['Manrope'] font-medium text-sm hover:bg-white transition-colors flex items-center justify-center gap-2"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">support_agent</span>
              Support Concierge
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <div className="flex-1 lg:ml-[17rem] flex flex-col">

          {/* Top bar */}
          <header className="fixed top-0 right-0 z-40 bg-[#faf9f7]/82 backdrop-blur-xl shadow-[0_20px_40px_rgba(26,28,27,0.06)] w-full lg:w-[calc(100%-17rem)] px-6 lg:px-12 py-5 flex justify-between items-center">
            <div className="font-['Noto_Serif'] text-[1.7rem] leading-none tracking-[-0.03em] text-[#7d2f12]">
              Atelier Meridian
            </div>
            <div className="flex items-center gap-3 md:gap-5">
              {activeTab === 'menu' || activeTab === 'settings' ? (
                <div className="relative hidden md:block">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#4e4639] text-[18px]">search</span>
                  <input
                    type="text"
                    value={shellSearch}
                    onChange={(e) => setShellSearch(e.target.value)}
                    placeholder={TAB_SEARCH_PLACEHOLDERS[activeTab]}
                    className="w-64 rounded-2xl bg-[#e9e8e6]/92 pl-10 pr-4 py-2.5 font-['Manrope'] text-sm text-[#1a1c1b] outline-none placeholder:text-[#6c6457] focus:bg-white focus:ring-1 focus:ring-[#d8c7ac]"
                  />
                </div>
              ) : null}
              {slaBreachedCount > 0 ? (
                <div className="hidden md:flex items-center gap-1.5 text-[#ba1a1a]">
                  <span className="material-symbols-outlined text-[20px]">warning</span>
                  <span className="font-['Manrope'] text-xs font-semibold uppercase tracking-widest">{slaBreachedCount} SLA</span>
                </div>
              ) : null}
              <button className="text-[#a44615] hover:text-[#8b300f] transition-colors" type="button">
                <span className="material-symbols-outlined text-[24px]">notifications</span>
              </button>
              <button className="text-[#a44615] hover:text-[#8b300f] transition-colors" type="button">
                <span className="material-symbols-outlined text-[24px]">account_circle</span>
              </button>
            </div>
          </header>

          <main className="flex-1 pt-28 px-6 lg:px-12 pb-24 max-w-[1240px] mx-auto w-full">

            <div className="mb-8 lg:hidden overflow-x-auto">
              <div className="inline-flex min-w-max gap-2 rounded-full bg-white/78 p-1.5 shadow-[0_16px_34px_rgba(26,28,27,0.06)] ring-1 ring-[#efe8de]">
                {navItems.map(({ id, label, icon, badge }) => {
                  const isActive = activeTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveTab(id)}
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
              <div className="mb-8 flex items-center justify-between rounded-[18px] bg-[#1a1c1b] px-5 py-3 shadow-[0_18px_36px_rgba(26,28,27,0.12)]">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[#c5a059] text-[20px] shrink-0">notifications</span>
                  <p className="font-['Manrope'] text-sm text-white">{notificationMessage}</p>
                </div>
                <button
                  className="text-white/60 hover:text-white text-xs font-['Manrope'] uppercase tracking-widest ml-4 shrink-0"
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
              <div>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-12">
                  <div>
                    <h2 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] tracking-tight font-semibold">Live Orders</h2>
                    <p className="font-['Manrope'] text-[#5f5e5e] mt-2 text-sm tracking-wide">Currently monitoring active in-room dining requests.</p>
                  </div>
                  <div className="flex gap-3">
                    <button className="rounded-full bg-[#efe8dc] px-6 py-2.5 font-['Manrope'] text-sm font-semibold text-[#775a19] transition hover:bg-[#e4d6be]" type="button">
                      Filter
                    </button>
                    <button className="rounded-[14px] bg-[#775a19] px-5 py-2.5 font-['Manrope'] text-sm font-semibold text-white shadow-[0_8px_16px_rgba(119,90,25,0.15)] transition hover:bg-[#5d4201]" type="button">
                      Pause New Orders
                    </button>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                  <div className={`${ELEVATED_PANEL_CLASS} p-6`}>
                    <p className="font-['Manrope'] text-xs tracking-widest text-[#5f5e5e] uppercase mb-1">Total Active</p>
                    <p className="font-['Noto_Serif'] text-3xl text-[#1a1c1b]">{activeOrders.length}</p>
                  </div>
                  <div className={`${ELEVATED_PANEL_CLASS} p-6`}>
                    <p className="font-['Manrope'] text-xs tracking-widest text-[#5f5e5e] uppercase mb-1">Avg. Prep Time</p>
                    <p className="font-['Noto_Serif'] text-3xl text-[#1a1c1b]">{averagePrepMinutes} <span className="font-['Manrope'] text-lg text-[#5f5e5e]">min</span></p>
                  </div>
                  <div className={`${TONAL_PANEL_CLASS} p-6`}>
                    <p className="font-['Manrope'] text-xs tracking-widest text-[#5f5e5e] uppercase mb-1">Delayed</p>
                    <p className="font-['Noto_Serif'] text-3xl text-[#ba1a1a]">{slaBreachedCount}</p>
                  </div>
                </div>

                {visibleOrders.length === 0 ? (
                  <div className={`${ELEVATED_PANEL_CLASS} p-12 text-center`}>
                    <span className="material-symbols-outlined text-[#d1c5b4] text-[48px]">restaurant</span>
                    <p className="font-['Manrope'] text-sm text-[#4e4639] mt-4">No active orders match the current queue.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {visibleOrders.map((order) => {
                      const sla = isOrderSlaBreached(order);
                      const primaryAction = getOrderNextAction(order.status);
                      return (
                        <div
                          key={order.id}
                          className={`${ELEVATED_PANEL_CLASS} overflow-hidden flex flex-col md:flex-row ${
                            sla ? 'ring-[#e4bbb9] ring-2' : ''
                          }`}
                        >
                          <div className={`w-full md:w-[6px] ${sla ? 'bg-[#ba1a1a]' : 'bg-[#efe8dc]'}`} />
                          <div className="p-6 md:w-[24%] bg-[#f4f3f1]/88 flex flex-col justify-between">
                            <div>
                              <span className={`inline-block px-3 py-1 text-xs font-['Manrope'] tracking-wide uppercase rounded-sm mb-5 ${
                                sla ? 'bg-[#ffdad6] text-[#93000a]' : STATUS_COLORS[order.status] || 'bg-[#e9e8e6] text-[#1a1c1b]'
                              }`}>
                                {sla ? 'Delayed' : formatStatusLabel(order.status)}
                              </span>
                              <h3 className="font-['Noto_Serif'] text-[2rem] leading-none text-[#1a1c1b]">Suite {order.roomNumber}</h3>
                              <p className="font-['Manrope'] text-sm text-[#5f5e5e] mt-3">{order.lastName || 'Guest'}</p>
                            </div>
                            <div className="mt-10">
                              <p className="font-['Manrope'] text-[10px] text-[#5f5e5e] tracking-widest uppercase">Ordered</p>
                              <p className="font-['Manrope'] font-medium text-[#1a1c1b] text-sm mt-1">
                                {order.createdAt ? order.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unknown'}
                                {' '}
                                ({formatRelativeTime(order.createdAt)})
                              </p>
                            </div>
                          </div>

                          <div className="p-6 flex-1 flex flex-col justify-between">
                            <ul className="space-y-5">
                              {order.items.map((item) => (
                                <li key={item.id} className="flex justify-between items-start gap-6">
                                  <div>
                                    <p className="font-['Manrope'] text-[2rem] leading-none text-[#1a1c1b] md:text-[1.15rem]">{item.qty}x {item.name}</p>
                                    {item.note ? <p className="font-['Manrope'] text-sm text-[#5f5e5e] mt-2">{item.note}</p> : null}
                                  </div>
                                  <span className="font-['Manrope'] text-sm text-[#5f5e5e]">{formatIdr(item.qty * item.price)}</span>
                                </li>
                              ))}
                            </ul>
                            <div className="mt-8 flex flex-wrap justify-between items-center gap-3 bg-[#fcfbf9] px-6 py-5">
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
                                    {order.rating ? <span className="font-['Manrope'] text-xs text-[#5f5e5e]">· {order.rating}/5 ★</span> : null}
                                  </>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-3 justify-end">
                                <button
                                  className="font-['Manrope'] text-sm text-[#775a19] px-3 py-2.5 rounded-[14px] hover:bg-[#f4f3f1] transition-colors"
                                  type="button"
                                >
                                  Message Guest
                                </button>
                                {primaryAction ? (
                                  <button
                                    className="rounded-[14px] bg-[#8b6418] px-5 py-2.5 font-['Manrope'] text-sm font-semibold text-white transition hover:bg-[#775a19]"
                                    onClick={() => updateOrderStatus(order.id, primaryAction.nextStatus)}
                                    type="button"
                                  >
                                    {primaryAction.label}
                                  </button>
                                ) : null}
                                <button
                                  className="font-['Manrope'] text-sm font-medium bg-[#efeeec] text-[#1a1c1b] px-4 py-2.5 rounded-[14px] hover:bg-[#e9e8e6] transition-colors"
                                  onClick={() => markAsRead(order.id)} type="button"
                                >
                                  Mark Read
                                </button>
                                {(order.accessTokenId || order.guestUid) ? (
                                  <button
                                    className="font-['Manrope'] text-sm font-medium text-[#ba1a1a] px-4 py-2.5 rounded-[14px] border border-[#ba1a1a]/20 hover:bg-[#ffdad6] transition-colors disabled:opacity-50 flex items-center gap-1"
                                    disabled={revokingSessionId === (order.accessTokenId || order.guestUid)}
                                    onClick={() => handleRevokeGuest(order.accessTokenId || order.guestUid)}
                                    type="button"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">block</span>
                                    Revoke
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
              <div>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-14 gap-6">
                  <div>
                    <h2 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] tracking-tight mb-2">Curated Offerings</h2>
                    <p className="font-['Manrope'] text-[#4e4639] max-w-md text-sm">Manage the culinary portfolio for in-room dining. Adjust availability to reflect real-time kitchen capacity.</p>
                  </div>
                  <button
                    className="bg-[#8b6418] text-white px-6 py-3 rounded-[14px] text-sm font-['Manrope'] font-medium tracking-wide hover:bg-[#775a19]/90 transition-all flex items-center gap-2 shadow-[0_14px_30px_rgba(119,90,25,0.18)] shrink-0"
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
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                  {visibleProducts.map((product) => (
                    <article key={product.id} className={`group ${ELEVATED_PANEL_CLASS} overflow-hidden relative max-w-[22rem] transition-transform duration-300 hover:-translate-y-1`}>
                      <div className="h-56 overflow-hidden relative bg-[#e9e8e6]">
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
                      <div className="p-5 relative -mt-8">
                        <div className="flex justify-between items-start gap-4 mb-2">
                          <h3 className="font-['Noto_Serif'] text-[2rem] leading-[1.05] text-[#1a1c1b]">{product.name}</h3>
                          <span className="font-['Noto_Serif'] text-lg text-[#775a19]">{formatIdr(product.price)}</span>
                        </div>
                        <p className="font-['Manrope'] text-sm text-[#4e4639] mb-2 line-clamp-2">{product.description}</p>
                        <p className="font-['Manrope'] text-xs text-[#4e4639]/70 uppercase tracking-widest">{product.category}</p>
                        <div className="flex justify-between items-center pt-6 mt-6 border-t border-[#f4f3f1]">
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
                              className="text-[#ba1a1a] hover:text-[#93000a] transition-colors p-2 rounded-full hover:bg-[#ffdad6]"
                              onClick={() => deleteProduct(product.id)} type="button"
                            >
                              <span className="material-symbols-outlined text-[20px]">delete</span>
                            </button>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox" className="sr-only peer"
                                checked={product.isAvailable}
                                onChange={() => toggleProductAvailability(product)}
                              />
                              <div className="w-11 h-6 bg-[#e9e8e6] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-[#e9e8e6] after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#775a19]" />
                            </label>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                  {visibleProducts.length === 0 ? (
                    <div className={`col-span-full ${ELEVATED_PANEL_CLASS} p-12 text-center`}>
                      <span className="material-symbols-outlined text-[#d1c5b4] text-[48px]">menu_book</span>
                      <p className="font-['Manrope'] text-sm text-[#4e4639] mt-4">No items match your search.</p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* ══════════════════════════════════════════
                FEEDBACK
            ══════════════════════════════════════════ */}
            {activeTab === 'feedback' ? (
              <div>
                <div className="flex flex-col md:flex-row md:justify-between md:items-end mb-10 gap-6">
                  <div className="max-w-2xl">
                    <span className="uppercase tracking-[0.1em] text-xs font-bold text-[#775a19] mb-3 block font-['Manrope']">Guest Relations</span>
                    <h2 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] tracking-tight mb-3">Curated Feedback</h2>
                    <p className="font-['Manrope'] text-[#4e4639] text-base font-light leading-relaxed">Review recent dining experiences to maintain the exacting standards of our culinary service.</p>
                  </div>
                  <div className="flex gap-4 shrink-0">
                    <div className={`${TONAL_PANEL_CLASS} p-5 min-w-[120px]`}>
                      <span className="block text-sm text-[#4e4639] font-['Manrope'] mb-1">Avg Rating</span>
                      <div className="flex items-baseline gap-2">
                        <span className="font-['Noto_Serif'] text-3xl text-[#1a1c1b]">{averageRating}</span>
                        <span className="material-symbols-outlined text-[#775a19] text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                      </div>
                    </div>
                    <div className={`${TONAL_PANEL_CLASS} p-5 min-w-[120px]`}>
                      <span className="block text-sm text-[#4e4639] font-['Manrope'] mb-1">Reviews</span>
                      <span className="font-['Noto_Serif'] text-3xl text-[#1a1c1b]">{feedbackOrders.length}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12 items-center">
                  <div className="lg:col-span-4 relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#4e4639]">search</span>
                    <input
                      type="text"
                      value={feedbackSearch}
                      onChange={(e) => setFeedbackSearch(e.target.value)}
                      placeholder="Search suite, keyword, or guest..."
                      className="w-full rounded-[14px] bg-[#e9e8e6] py-4 pl-12 pr-4 font-['Manrope'] text-sm text-[#1a1c1b] outline-none transition focus:bg-white focus:shadow-[0_4px_20px_rgba(26,28,27,0.04)]"
                    />
                  </div>
                  <div className="lg:col-span-8 flex flex-wrap gap-3 justify-start lg:justify-end">
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
                        className={`rounded-full border px-5 py-3 font-['Manrope'] text-xs font-semibold uppercase tracking-[0.16em] transition ${
                          feedbackFilter === option.id
                            ? 'border-[#775a19] bg-white text-[#775a19]'
                            : 'border-[#d1c5b4]/40 bg-white text-[#4e4639] hover:bg-[#f4f3f1]'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredFeedbackOrders.length === 0 ? (
                  <div className={`${ELEVATED_PANEL_CLASS} p-12 text-center`}>
                    <span className="material-symbols-outlined text-[#d1c5b4] text-[48px]">reviews</span>
                    <p className="font-['Manrope'] text-sm text-[#4e4639] mt-4">No guest feedback yet.</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div className="grid grid-cols-1 xl:grid-cols-[1.45fr_0.7fr] gap-8">
                      {feedbackHeroOrder ? (
                        <article className={`${ELEVATED_PANEL_CLASS} p-10`}>
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
                              <h3 className="font-['Noto_Serif'] text-[2.6rem] leading-[1.02] text-[#1a1c1b]">
                                {feedbackHeroOrder.feedbackSummary || 'Exceptional dining service'}
                              </h3>
                            </div>
                            <span className="bg-[#f4f3f1] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[#4e4639]">
                              Suite {feedbackHeroOrder.roomNumber}
                            </span>
                          </div>
                          <p className="mt-8 max-w-4xl font-['Manrope'] text-[1.05rem] leading-9 text-[#4e4639]">
                            "{feedbackHeroOrder.feedbackText || feedbackHeroOrder.feedbackSummary || 'Guest submitted a rating without written comments.'}"
                          </p>
                          <div className="mt-10 flex items-end justify-between gap-6 border-t border-[#f4f3f1] pt-7">
                            <div className="flex items-center gap-4">
                              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1a1c1b] text-white">
                                {feedbackHeroOrder.lastName?.slice(0, 1) || 'G'}
                              </div>
                              <div>
                                <p className="font-['Manrope'] text-base text-[#1a1c1b]">{feedbackHeroOrder.lastName || 'Guest'}</p>
                                <p className="font-['Manrope'] text-sm text-[#5f5e5e]">{formatFeedbackTime(feedbackHeroOrder.createdAt)}</p>
                              </div>
                            </div>
                            <button className="font-['Manrope'] text-sm uppercase tracking-[0.14em] text-[#8b6418]" type="button">
                              Acknowledge
                            </button>
                          </div>
                        </article>
                      ) : null}

                      {feedbackSideOrder ? (
                        <article className={`${ELEVATED_PANEL_CLASS} p-8`}>
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
                            <span className="text-sm uppercase tracking-[0.18em] text-[#4e4639]">Suite {feedbackSideOrder.roomNumber}</span>
                          </div>
                          <h3 className="font-['Noto_Serif'] text-[2rem] leading-tight text-[#1a1c1b]">
                            {feedbackSideOrder.feedbackSummary || 'Lovely, with minor notes'}
                          </h3>
                          <p className="mt-6 font-['Manrope'] text-base leading-8 text-[#4e4639]">
                            "{feedbackSideOrder.feedbackText || feedbackSideOrder.feedbackSummary || 'Guest shared a concise dining impression.'}"
                          </p>
                          <div className="mt-12 flex items-end justify-between gap-4 border-t border-[#f4f3f1] pt-6">
                            <p className="font-['Manrope'] text-sm text-[#5f5e5e]">{formatFeedbackTime(feedbackSideOrder.createdAt)}</p>
                            <button className="font-['Manrope'] text-sm uppercase tracking-[0.14em] text-[#8b6418]" type="button">
                              Reply
                            </button>
                          </div>
                        </article>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-[0.7fr_1.3fr] gap-8">
                      {feedbackIssueOrder ? (
                        <article className={`${ELEVATED_PANEL_CLASS} relative overflow-hidden p-8`}>
                          <div className="absolute inset-y-0 left-0 w-[4px] bg-[#e4bbb9]" />
                          <div className="ml-3">
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
                              <span className="text-sm uppercase tracking-[0.18em] text-[#4e4639]">Suite {feedbackIssueOrder.roomNumber}</span>
                            </div>
                            <h3 className="font-['Noto_Serif'] text-[2rem] leading-tight text-[#1a1c1b]">
                              {feedbackIssueOrder.feedbackSummary || 'Delayed service'}
                            </h3>
                            <p className="mt-6 font-['Manrope'] text-base leading-8 text-[#4e4639]">
                              "{feedbackIssueOrder.feedbackText || 'Action required on this guest experience.'}"
                            </p>
                            <div className="mt-10 flex items-end justify-between gap-4 border-t border-[#f4f3f1] pt-6">
                              <div>
                                <p className="font-['Manrope'] text-sm text-[#ba1a1a]">Action Required</p>
                                <p className="font-['Manrope'] text-sm text-[#5f5e5e]">{formatFeedbackTime(feedbackIssueOrder.createdAt)}</p>
                              </div>
                              <button className="font-['Manrope'] text-sm uppercase tracking-[0.14em] text-[#ba1a1a]" type="button">
                                Resolve
                              </button>
                            </div>
                          </div>
                        </article>
                      ) : null}

                      {feedbackStoryOrder ? (
                        <article className={`${ELEVATED_PANEL_CLASS} p-8`}>
                          <div className="grid gap-6 lg:grid-cols-[1fr_0.72fr]">
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
                              <div className="mb-5 flex items-center justify-between gap-4">
                                <h3 className="font-['Noto_Serif'] text-[2rem] leading-tight text-[#1a1c1b]">
                                  {feedbackStoryOrder.feedbackSummary || 'A perfect late night supper'}
                                </h3>
                                <span className="bg-[#f4f3f1] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[#4e4639]">
                                  Suite {feedbackStoryOrder.roomNumber}
                                </span>
                              </div>
                              <p className="font-['Manrope'] text-base leading-8 text-[#4e4639]">
                                "{feedbackStoryOrder.feedbackText || feedbackStoryOrder.feedbackSummary || 'Guest shared a memorable meal recap.'}"
                              </p>
                            </div>
                            <div className="border-t border-[#f4f3f1] pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                              <p className="font-['Manrope'] text-sm font-semibold text-[#1a1c1b]">Ordered Items</p>
                              <ul className="mt-4 space-y-2 font-['Manrope'] text-sm leading-7 text-[#4e4639]">
                                {feedbackStoryOrder.items.slice(0, 4).map((item) => (
                                  <li key={item.id}>- {item.name}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                          <div className="mt-8 flex items-end justify-between gap-4 border-t border-[#f4f3f1] pt-6">
                            <p className="font-['Manrope'] text-sm text-[#5f5e5e]">{formatFeedbackTime(feedbackStoryOrder.createdAt)}</p>
                            <button className="font-['Manrope'] text-sm uppercase tracking-[0.14em] text-[#8b6418]" type="button">
                              Acknowledge
                            </button>
                          </div>
                        </article>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* ══════════════════════════════════════════
                REVENUE
            ══════════════════════════════════════════ */}
            {activeTab === 'revenue' ? (
              <ManagerOnly role={identity.role}>
                <div>
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-12">
                    <div className="flex gap-2 rounded-full border border-[#e3ddd3] bg-[#f4f3f1] p-1">
                      {(['daily', 'weekly', 'monthly'] as const).map((range) => (
                        <button
                          key={range}
                          type="button"
                          onClick={() => setRevenueRange(range)}
                          className={`rounded-full px-6 py-2 font-['Manrope'] text-sm transition ${
                            revenueRange === range ? 'bg-white text-[#775a19] shadow-sm' : 'text-[#5f5e5e]'
                          }`}
                        >
                          {range[0].toUpperCase() + range.slice(1)}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-3">
                      <input
                        className="rounded-[14px] bg-[#e9e8e6]/92 px-4 py-2.5 font-['Manrope'] text-sm text-[#1a1c1b] outline-none ring-1 ring-[#ece5db]"
                        type="date" value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                      />
                      <button
                        className="flex items-center gap-2 text-[#775a19] font-['Manrope'] font-medium text-sm px-4 py-2.5 border border-[#d1c5b4]/30 rounded-[14px] hover:bg-[#f4f3f1] transition-colors"
                        onClick={exportRevenue} type="button"
                      >
                        <span className="material-symbols-outlined text-[18px]">download</span>
                        Export Report
                      </button>
                    </div>
                  </div>

                  {/* KPI Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                    <div className={`${ELEVATED_PANEL_CLASS} p-8 relative overflow-hidden group`}>
                      <div className="absolute -right-8 -top-8 w-32 h-32 bg-[#c5a059]/10 rounded-full blur-2xl group-hover:bg-[#c5a059]/20 transition-all" />
                      <p className="font-['Manrope'] text-xs uppercase tracking-widest text-[#5f5e5e] mb-2">Total Revenue</p>
                      <h3 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] mb-4 tracking-tight">{formatIdr(revenueOverview.revenue)}</h3>
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`material-symbols-outlined text-sm ${revenueOverview.revenueDelta >= 0 ? 'text-[#775a19]' : 'text-[#ba1a1a]'}`}>
                          {revenueOverview.revenueDelta >= 0 ? 'trending_up' : 'trending_down'}
                        </span>
                        <span className="font-['Manrope'] text-xs text-[#5f5e5e]">
                          {`${revenueOverview.revenueDelta >= 0 ? '+' : ''}${revenueOverview.revenueDelta.toFixed(1)}% vs last period`}
                        </span>
                      </div>
                    </div>
                    <div className={`${TONAL_PANEL_CLASS} p-8 relative overflow-hidden`}>
                      <p className="font-['Manrope'] text-xs uppercase tracking-widest text-[#5f5e5e] mb-2">Average Order Value</p>
                      <h3 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] mb-4 tracking-tight">{formatIdr(revenueOverview.averageOrderValue)}</h3>
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`material-symbols-outlined text-sm ${revenueOverview.averageDelta >= 0 ? 'text-[#775a19]' : 'text-[#ba1a1a]'}`}>
                          {revenueOverview.averageDelta >= 0 ? 'trending_up' : 'trending_down'}
                        </span>
                        <span className="font-['Manrope'] text-xs text-[#5f5e5e]">
                          {`${revenueOverview.averageDelta >= 0 ? '+' : ''}${revenueOverview.averageDelta.toFixed(1)}% vs last period`}
                        </span>
                      </div>
                    </div>
                    <div className={`${TONAL_PANEL_CLASS} p-8 relative overflow-hidden`}>
                      <p className="font-['Manrope'] text-xs uppercase tracking-widest text-[#5f5e5e] mb-2">Total Orders</p>
                      <h3 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] mb-4 tracking-tight">{revenueOverview.totalOrders}</h3>
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`material-symbols-outlined text-sm ${revenueOverview.ordersDelta >= 0 ? 'text-[#775a19]' : 'text-[#ba1a1a]'}`}>
                          {revenueOverview.ordersDelta >= 0 ? 'trending_up' : 'trending_down'}
                        </span>
                        <span className="font-['Manrope'] text-xs text-[#5f5e5e]">
                          {`${revenueOverview.ordersDelta >= 0 ? '+' : ''}${revenueOverview.ordersDelta.toFixed(1)}% vs last period`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className={`${ELEVATED_PANEL_CLASS} p-8 mb-10`}>
                    <div className="mb-8 flex items-center justify-between gap-4">
                      <h3 className="font-['Noto_Serif'] text-[2.1rem] text-[#1a1c1b]">Revenue Trend</h3>
                      <button className="text-[#5f5e5e]" type="button">
                        <span className="material-symbols-outlined">more_horiz</span>
                      </button>
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-6">
                      <div className="hidden h-[280px] flex-col justify-between py-4 text-xs text-[#7c7366] sm:flex">
                        {[1, 0.8, 0.6, 0.4, 0.2].map((step) => (
                          <span key={step}>{formatCompactCurrency(Math.max(...revenueTrend.map((point) => point.value), 0) * step)}</span>
                        ))}
                      </div>
                      <div>
                        <div className="relative h-[280px] w-full overflow-hidden rounded-[18px] bg-[#fffdf9]">
                          <svg viewBox="0 0 720 280" preserveAspectRatio="none" className="h-full w-full">
                            {[40, 90, 140, 190, 240].map((y) => (
                              <line key={y} x1="0" y1={y} x2="720" y2={y} stroke="#f1ece4" strokeWidth="1" />
                            ))}
                            {(() => {
                              const maxValue = Math.max(...revenueTrend.map((point) => point.value), 1);
                              const coordinates = revenueTrend.map((point, index) => {
                                const x = revenueTrend.length === 1 ? 360 : (index * (720 / (revenueTrend.length - 1)));
                                const y = 240 - ((point.value / maxValue) * 180);
                                return { x, y, value: point.value };
                              });
                              const linePath = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
                              const areaPath = `${linePath} L 720 240 L 0 240 Z`;
                              return (
                                <>
                                  <path d={areaPath} fill="url(#revenueArea)" opacity="0.22" />
                                  <path d={linePath} fill="none" stroke="#8b6418" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                                  {coordinates.map((point) => (
                                    <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="6" fill="#ffffff" stroke="#8b6418" strokeWidth="3" />
                                  ))}
                                  <defs>
                                    <linearGradient id="revenueArea" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="#c5a059" />
                                      <stop offset="100%" stopColor="#ffffff" />
                                    </linearGradient>
                                  </defs>
                                </>
                              );
                            })()}
                          </svg>
                        </div>
                        <div
                          className="mt-4 grid gap-3"
                          style={{ gridTemplateColumns: `repeat(${revenueTrend.length}, minmax(0, 1fr))` }}
                        >
                          {revenueTrend.map((point) => (
                            <div key={point.label} className="text-center">
                              <p className="font-['Manrope'] text-xs uppercase tracking-[0.16em] text-[#7c7366]">{point.label}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.92fr] gap-12">
                    <div>
                      <h3 className="mb-6 border-b border-[#ece5db] pb-4 font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Top Performing Signatures</h3>
                      <div className="space-y-6">
                        {revenueLeaders.map((item) => (
                          <div key={item.name} className={`${ELEVATED_PANEL_CLASS} flex items-center justify-between p-5`}>
                            <div className="flex items-center gap-4">
                              <div className="h-[72px] w-[72px] overflow-hidden rounded-[10px] bg-[#e9e8e6]">
                                {item.image ? (
                                  <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <span className="material-symbols-outlined text-[#d1c5b4]">restaurant</span>
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="font-['Manrope'] text-xl text-[#1a1c1b]">{item.name}</p>
                              <p className="mt-1 font-['Manrope'] text-sm text-[#5f5e5e]">{item.orders} Orders</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-['Noto_Serif'] text-2xl text-[#775a19]">{formatIdr(item.revenue)}</p>
                            <p className="mt-1 font-['Manrope'] text-sm text-[#5f5e5e]">
                                {revenueOverview.revenue ? `${((item.revenue / revenueOverview.revenue) * 100).toFixed(1)}% of rev` : '0% of rev'}
                            </p>
                          </div>
                        </div>
                        ))}
                        {revenueLeaders.length === 0 ? <p className="text-sm text-[#4e4639]">No signature data available yet.</p> : null}
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <h3 className="mb-6 border-b border-[#ece5db] pb-4 font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Revenue Distribution</h3>
                        <div className="space-y-8">
                          {revenueDistribution.map((segment, index) => (
                            <div key={segment.label}>
                              <div className="mb-2 flex items-center justify-between gap-4">
                                <span className="font-['Manrope'] text-lg text-[#1a1c1b]">{segment.label}</span>
                                <span className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">{formatIdr(segment.revenue)}</span>
                              </div>
                              <div className="h-3 rounded-full bg-[#ece8e1]">
                                <div
                                  className={`h-3 rounded-full ${index === 0 ? 'bg-[#8b6418]' : index === 1 ? 'bg-[#c5a059]' : 'bg-[#d7c49b]'}`}
                                  style={{ width: `${Math.max(segment.percent, 8)}%` }}
                                />
                              </div>
                            </div>
                          ))}
                          {revenueDistribution.length === 0 ? <p className="text-sm text-[#4e4639]">No revenue distribution data available yet.</p> : null}
                        </div>
                      </div>

                      <div className={`${TONAL_PANEL_CLASS} p-6`}>
                        <p className="mb-3 font-['Manrope'] text-xs uppercase tracking-widest text-[#5f5e5e]">Insight</p>
                        <p className="font-['Manrope'] text-sm leading-7 text-[#4e4639]">
                          {revenueDistribution[0]
                            ? `${revenueDistribution[0].label} currently leads revenue contribution at ${revenueDistribution[0].percent}% of completed order value for the selected period.`
                            : 'Review completed orders by date to track revenue trends and identify peak service windows.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </ManagerOnly>
            ) : null}

            {/* ══════════════════════════════════════════
                SHIFT HANDOVER NOTES
            ══════════════════════════════════════════ */}
            {activeTab === 'handover' ? (
              <div>
                <div className="mb-10">
                  <h2 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] tracking-tight">Handover Notes</h2>
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
                          placeholder="e.g. Suite 402 guest requires dairy-free options. Fryer #2 under maintenance until 18:00."
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
                                    <span className="font-['Manrope'] text-[10px] text-[#4e4639]/70">
                                      {note.createdAt ? note.createdAt.toLocaleString() : '—'}
                                    </span>
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
              <div>
                <div className="mb-16 flex justify-between items-end gap-6">
                  <div>
                    <h2 className="font-['Noto_Serif'] text-4xl text-[#1a1c1b] tracking-tight">General Settings</h2>
                    <p className="font-['Manrope'] text-[#5f5e5e] mt-2 text-sm">Configure core operational parameters for in-room dining.</p>
                  </div>
                  <button className="rounded-[14px] bg-[#8b6418] px-6 py-3 font-['Manrope'] text-sm font-medium tracking-wide text-white shadow-[0_8px_16px_rgba(119,90,25,0.15)] transition hover:bg-[#775a19]" type="button">
                    Save Changes
                  </button>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12">
                  <section className={`lg:col-span-8 ${ELEVATED_PANEL_CLASS} p-8`}>
                    <div className="mb-8 flex items-center gap-3 border-b border-[#f4f3f1] pb-4">
                      <span className="material-symbols-outlined text-[#c5a059]" style={{ fontVariationSettings: "'FILL' 1" }}>schedule</span>
                      <h3 className="font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Operating Hours</h3>
                    </div>
                    <div className="space-y-5">
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((day) => (
                        <div key={day} className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="flex items-center gap-4 md:w-1/3">
                            <input type="checkbox" defaultChecked className="h-5 w-5 accent-[#775a19]" />
                            <span className="font-['Manrope'] text-lg text-[#1a1c1b]">{day}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <input type="time" defaultValue="06:00" className="rounded-[10px] bg-[#f4f3f1] px-4 py-3 text-sm text-[#1a1c1b] outline-none ring-1 ring-[#ebe3d8]" />
                            <span className="text-sm text-[#5f5e5e]">to</span>
                            <input type="time" defaultValue="23:30" className="rounded-[10px] bg-[#f4f3f1] px-4 py-3 text-sm text-[#1a1c1b] outline-none ring-1 ring-[#ebe3d8]" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className={`lg:col-span-4 ${TONAL_PANEL_CLASS} p-8`}>
                    <div className="mb-8 flex items-center gap-3">
                      <span className="material-symbols-outlined text-[#775a19]" style={{ fontVariationSettings: "'FILL' 1" }}>account_balance</span>
                      <h3 className="font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Financials</h3>
                    </div>
                    <div className="space-y-8">
                      <div>
                        <label className="mb-3 block font-['Manrope'] text-xs uppercase tracking-[0.18em] text-[#5f5e5e]">Base Tax Rate (%)</label>
                        <input type="number" defaultValue="8.5" className="w-full border-b border-[#775a19] bg-[#e9e8e6] px-4 py-3 text-2xl text-[#1a1c1b] outline-none" />
                      </div>
                      <div>
                        <label className="mb-3 block font-['Manrope'] text-xs uppercase tracking-[0.18em] text-[#5f5e5e]">In-Room Dining Surcharge (%)</label>
                        <input type="number" defaultValue="18.0" className="w-full border-b border-[#775a19] bg-[#e9e8e6] px-4 py-3 text-2xl text-[#1a1c1b] outline-none" />
                        <p className="mt-2 text-sm text-[#5f5e5e]">Automatically applied to subtotal before tax.</p>
                      </div>
                    </div>
                  </section>
                </div>

                <section className={`${ELEVATED_PANEL_CLASS} mb-12 p-8`}>
                  <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
                    <div>
                      <div className="mb-4 flex items-center gap-3">
                        <span className="material-symbols-outlined text-[#c5a059]" style={{ fontVariationSettings: "'FILL' 1" }}>notifications_active</span>
                        <h3 className="font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Alert Preferences</h3>
                      </div>
                      <p className="max-w-sm font-['Manrope'] text-lg leading-8 text-[#4e4639]">
                        Manage how and when staff are notified of new orders, delays, or guest feedback.
                      </p>
                    </div>
                    <div className="grid gap-5 md:grid-cols-2">
                      {[
                        ['New Order Chime', 'Audible alert on kitchen tablets.', true],
                        ['VIP Guest Alert', 'SMS notification to duty manager.', true],
                        ['Delayed Order Warning', 'Alerts after 30 mins prep time.', true],
                        ['Daily Revenue Digest', 'Email sent at end of service.', false],
                      ].map(([title, copy, checked]) => (
                        <label key={title} className="flex items-start justify-between gap-4 rounded-[18px] bg-[#f4f3f1] p-4">
                          <div>
                            <p className="font-['Manrope'] text-lg font-medium text-[#1a1c1b]">{title}</p>
                            <p className="mt-1 font-['Manrope'] text-sm text-[#5f5e5e]">{copy}</p>
                          </div>
                          <input type="checkbox" defaultChecked={Boolean(checked)} className="mt-1 h-5 w-5 accent-[#775a19]" />
                        </label>
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

                    <section className={`${ELEVATED_PANEL_CLASS} p-8`}>
                      <div className="mb-7 flex items-center gap-3">
                        <span className="material-symbols-outlined text-[#775a19] text-[22px]">qr_code_2</span>
                        <h3 className="font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Guest QR Access</h3>
                      </div>
                      <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-5">
                          {[
                            { label: 'Hotel ID', value: hotelId, onChange: setHotelId, placeholder: '' },
                            { label: 'Stay ID', value: stayId, onChange: setStayId, placeholder: 'stay-1204-demo' },
                            { label: 'Room Number', value: roomNumber, onChange: setRoomNumber, placeholder: '1204' },
                            { label: 'Expiry (minutes)', value: expiresInMinutes, onChange: setExpiresInMinutes, placeholder: '720' },
                          ].map((field) => (
                            <div key={field.label}>
                              <label className="mb-2 block font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold">{field.label}</label>
                              <input type="text" value={field.value} placeholder={field.placeholder} onChange={(e) => field.onChange(e.target.value)} className="w-full rounded-[14px] bg-[#e9e8e6] px-4 py-3 font-['Manrope'] text-sm text-[#1a1c1b] outline-none" />
                            </div>
                          ))}
                          <div className="flex flex-wrap gap-3 pt-2">
                            <button className="rounded-[14px] bg-[#1a1c1b] px-5 py-3 font-['Manrope'] text-xs uppercase tracking-widest text-white disabled:opacity-50" disabled={isGeneratingToken} onClick={handleGenerateQr} type="button">
                              {isGeneratingToken ? 'Generating…' : 'Generate QR'}
                            </button>
                            {tokenResult?.qrUrl ? (
                              <button className="rounded-[14px] border border-[#d1c5b4]/50 px-5 py-3 font-['Manrope'] text-xs uppercase tracking-widest text-[#4e4639]" onClick={copyTokenUrl} type="button">
                                Copy URL
                              </button>
                            ) : null}
                          </div>
                          {tokenStatus ? <p className="font-['Manrope'] text-xs text-[#4e4639]">{tokenStatus}</p> : null}
                        </div>
                        <div className={`${TONAL_PANEL_CLASS} p-5`}>
                          <p className="mb-4 font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold">Print Pack</p>
                          {tokenResult ? (
                            <div className="space-y-4 font-['Manrope'] text-sm">
                              {[
                                { label: 'Guest URL', value: tokenResult.qrUrl, mono: true },
                                { label: 'Raw Token', value: tokenResult.rawToken, mono: true },
                                { label: 'Expires At', value: new Date(tokenResult.expiresAt).toLocaleString(), mono: false },
                              ].map((item) => (
                                <div key={item.label}>
                                  <p className="font-['Manrope'] text-[10px] uppercase tracking-widest text-[#4e4639]">{item.label}</p>
                                  <p className={`mt-1.5 rounded-[12px] bg-white px-3 py-2 text-xs text-[#1a1c1b] leading-5 break-all ${item.mono ? 'font-mono' : ''}`}>{item.value}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="font-['Manrope'] text-sm leading-6 text-[#4e4639]">Generate a guest access link for the front-office print workflow.</p>
                          )}
                        </div>
                      </div>
                    </section>
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

          </main>
        </div>
      </div>

      {/* ── Menu editor modal ── */}
      {editingProduct ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1a1c1b]/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white rounded-lg shadow-[0_20px_60px_rgba(26,28,27,0.2)] max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-[#f4f3f1] flex items-start justify-between gap-4">
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
            <div className="p-6 grid gap-5 md:grid-cols-2">
              {([
                { label: 'Item Name', key: 'name' as const },
                { label: 'Category', key: 'category' as const },
                { label: 'Price', key: 'price' as const },
                { label: 'Image URL', key: 'image' as const },
              ] as { label: string; key: keyof MenuEditorState }[]).map((field) => (
                <UnderlineInput
                  key={field.key} id={field.key} label={field.label}
                  value={String(editingProduct[field.key])}
                  onChange={(v) => setEditingProduct((c) => c ? { ...c, [field.key]: v } : c)}
                />
              ))}
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
              <label className="md:col-span-2 flex items-center gap-3 bg-[#f4f3f1] px-4 py-3 rounded font-['Manrope'] text-sm text-[#1a1c1b] cursor-pointer">
                <input
                  checked={editingProduct.isAvailable}
                  className="w-4 h-4 accent-[#775a19]" type="checkbox"
                  onChange={(e) => setEditingProduct((c) => c ? { ...c, isAvailable: e.target.checked } : c)}
                />
                Ready for guest ordering
              </label>
            </div>
            <div className="px-6 pb-6 flex flex-wrap gap-3">
              <button
                className="bg-[#775a19] text-white font-['Manrope'] text-xs uppercase tracking-widest font-semibold px-5 py-3 rounded hover:bg-[#775a19]/90 transition-colors shadow-[0_4px_14px_rgba(119,90,25,0.2)]"
                onClick={() => saveProduct(editingProduct)} type="button"
              >
                Save Menu Item
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1a1c1b]/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[22px] bg-white shadow-[0_20px_60px_rgba(26,28,27,0.2)]">
            <div className="flex items-start justify-between gap-4 border-b border-[#f4f3f1] p-6">
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
            <div className="grid gap-5 p-6 md:grid-cols-2">
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
            <div className="flex flex-wrap gap-3 px-6 pb-6">
              <button
                type="button"
                disabled={isSavingStaff || !staffEditor.name.trim() || !staffEditor.username.trim() || !staffEditor.email.trim() || (!staffEditor.uid && !staffEditor.password.trim())}
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
    </div>
  );
}
