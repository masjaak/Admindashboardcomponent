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
import {
  AlertTriangle,
  Bell,
  BookOpen,
  CheckCircle2,
  Clock,
  Copy,
  LayoutGrid,
  LineChart,
  LogOut,
  MessageSquare,
  PencilLine,
  Plus,
  QrCode,
  Search,
  Settings2,
  ShieldBan,
  ShieldCheck,
  Sparkles,
  UserCircle2,
  UtensilsCrossed,
} from 'lucide-react';
import { auth, db } from '../../lib/firebase';
import { createGuestQrToken, revokeGuestSessionAsAdmin } from '../../lib/adminAccess';
import { useDynamicTitle } from '../../hooks/useDynamicTitle';
import { useWakeLock } from '../../hooks/useWakeLock';
import { getNewIncomingOrderIds } from '../../admin/notifications';
import { buildRevenueExport, summarizeRevenue } from '../../admin/revenue';
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

const ORDER_STATUSES = [
  'incoming',
  'confirmed',
  'kitchen',
  'preparing',
  'quality_check',
  'delivery',
  'on_the_way',
  'delivered',
  'completed',
  'cancelled',
];

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
    <div className="rounded-lg border border-[#d1c5b4]/30 bg-[#f4f3f1] p-8">
      <div className="flex items-start gap-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-[#775a19]" />
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

  // UI state
  const [menuSearch, setMenuSearch] = useState('');
  const [editingProduct, setEditingProduct] = useState<MenuEditorState | null>(null);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Settings / QR
  const [hotelId, setHotelId] = useState('atelier-meridian-demo');
  const [stayId, setStayId] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState('720');
  const [tokenResult, setTokenResult] = useState<{ qrUrl: string; rawToken: string; expiresAt: string } | null>(null);
  const [tokenStatus, setTokenStatus] = useState('');
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

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
  const filteredProducts = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
    );
  }, [products, menuSearch]);
  const revenueSummary = useMemo(
    () => summarizeRevenue(
      orders.map((o) => ({
        id: o.id, roomNumber: o.roomNumber, total: o.total,
        status: o.status, paymentMethod: o.paymentMethod, createdAt: o.createdAt,
      })),
      new Date(`${selectedDate}T12:00:00`),
    ),
    [orders, selectedDate],
  );
  const shiftNotesByShift = useMemo(() => {
    const out: Record<ShiftName, ShiftNote[]> = { morning: [], afternoon: [], night: [] };
    for (const n of shiftNotes) out[n.shift].push(n);
    return out;
  }, [shiftNotes]);

  useDynamicTitle(unreadIncomingOrders.length);
  useWakeLock();

  /* ── Auth ── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setIdentity(null); setAuthReady(true); return; }
      const resolved = await loadIdentity(user);
      setIdentity(resolved);
      setAuthReady(true);
      if (!resolved) { setAuthError('Account is not active for admin access.'); await signOut(auth); }
    });
    return () => unsub();
  }, []);

  /* ── Firestore subscriptions ── */
  useEffect(() => {
    if (!identity) { setOrders([]); setProducts([]); setShiftNotes([]); return; }

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

    return () => { unsubOrders(); unsubProducts(); unsubNotes(); };
  }, [identity]);

  /* ── Nav ── */
  const navItems = [
    { id: 'orders' as const, label: 'Live Orders', icon: Bell, badge: unreadIncomingOrders.length || undefined },
    { id: 'menu' as const, label: 'Menu Manager', icon: LayoutGrid },
    { id: 'feedback' as const, label: 'Feedback', icon: MessageSquare, badge: needsReviewOrders.length || undefined },
    { id: 'revenue' as const, label: 'Revenue', icon: LineChart },
    { id: 'handover' as const, label: 'Handover Notes', icon: BookOpen },
    { id: 'settings' as const, label: 'Settings', icon: Settings2 },
  ];

  /* ── Helpers ── */
  async function loadIdentity(user: User): Promise<AdminIdentity | null> {
    const snap = await getDoc(doc(db, 'admin_users', user.uid));
    const profile = snap.exists() ? snap.data() : null;
    const session = resolveAdminSession({
      uid: user.uid,
      email: user.email || '',
      profile: profile
        ? { name: String(profile.name || 'Hotel Operator'), role: normalizeRole(profile.role), active: profile.active !== false }
        : null,
    });
    if (session.status !== 'authenticated') return null;
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

  /* ─────────────────── RENDER ─────────────────── */

  if (!authReady) return <div className="min-h-screen bg-[#faf9f7]" />;

  /* ── Login ── */
  if (!identity) {
    return (
      <div className="relative min-h-screen font-['Manrope'] flex items-center justify-center overflow-hidden">

        {/* Full-screen background: hotel lobby image + warm overlay */}
        <div className="absolute inset-0 z-0">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url('https://lh3.googleusercontent.com/aida-public/AB6AXuCWL_a1MEzQsNxi6caSoxN25GePda4Y-AYSVFBiUFV5gCQNr4-P7sUPPyV6OfoO4LqjRAR5UhmqIonXT6r5T9HvyKWfm9tlMqNFwP62Dcuyhtd0cg-9Uxbcqae6CApk4TzWi_zOiC0r_hCRhGIlATcTgmU6b_mQbLL1UDRghfD97jmHEIh8_1PRHsCO7_dG8MWgemMGuAXxm16SMsMxYMvrZGasddrV9xLRqzji141r_YuR7bpE_m8vfinbz2gOHZxaNJduhNJFlw')`,
            }}
          />
          {/* Dark warm multiply overlay */}
          <div className="absolute inset-0 bg-[#2f3130]/60 backdrop-blur-sm" style={{ mixBlendMode: 'multiply' }} />
          {/* Subtle gradient from bottom */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#faf9f7]/40 to-transparent" />
        </div>

        {/* Centered login card */}
        <div className="relative z-10 w-full max-w-md px-6 py-12 md:p-10">
          <div
            className="bg-white rounded-xl p-8 md:p-12"
            style={{ boxShadow: '0 20px 40px rgba(26, 28, 27, 0.08)' }}
          >
            {/* Branding */}
            <div className="text-center mb-10">
              <h1 className="font-['Noto_Serif'] text-2xl tracking-[0.2em] uppercase text-[#775a19] mb-3">
                Atelier Meridian
              </h1>
              <p className="font-['Manrope'] text-xs uppercase tracking-widest text-[#4e4639]">
                In-Room Dining Dashboard
              </p>
            </div>

            {/* Form */}
            <form className="space-y-5" onSubmit={handleLogin}>

              {/* Staff ID / Email — floating label */}
              <div className="relative">
                <input
                  id="credential"
                  type="text"
                  placeholder="Staff ID / Email"
                  autoComplete="username"
                  value={loginForm.credential}
                  onChange={(e) => setLoginForm((c) => ({ ...c, credential: e.target.value }))}
                  className="peer w-full bg-[#e9e8e6] border-none rounded-sm px-4 pt-6 pb-2 font-['Manrope'] text-sm text-[#1a1c1b] focus:bg-white focus:ring-1 focus:ring-[#d1c5b4] focus:outline-none transition-colors duration-300 placeholder-transparent"
                />
                <label
                  htmlFor="credential"
                  className="absolute left-4 top-4 font-['Manrope'] text-sm text-[#4e4639] pointer-events-none transition-all duration-300
                    peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm
                    peer-focus:top-2 peer-focus:text-[10px] peer-focus:text-[#775a19] peer-focus:tracking-[0.15em] peer-focus:uppercase
                    peer-not-placeholder-shown:top-2 peer-not-placeholder-shown:text-[10px] peer-not-placeholder-shown:tracking-[0.15em] peer-not-placeholder-shown:uppercase peer-not-placeholder-shown:text-[#775a19]"
                >
                  Staff ID / Email
                </label>
              </div>

              {/* Password — floating label + reveal toggle */}
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Secure Password"
                  autoComplete="current-password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm((c) => ({ ...c, password: e.target.value }))}
                  className="peer w-full bg-[#e9e8e6] border-none rounded-sm px-4 pt-6 pb-2 pr-12 font-['Manrope'] text-sm text-[#1a1c1b] focus:bg-white focus:ring-1 focus:ring-[#d1c5b4] focus:outline-none transition-colors duration-300 placeholder-transparent"
                />
                <label
                  htmlFor="password"
                  className="absolute left-4 top-4 font-['Manrope'] text-sm text-[#4e4639] pointer-events-none transition-all duration-300
                    peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm
                    peer-focus:top-2 peer-focus:text-[10px] peer-focus:text-[#775a19] peer-focus:tracking-[0.15em] peer-focus:uppercase
                    peer-not-placeholder-shown:top-2 peer-not-placeholder-shown:text-[10px] peer-not-placeholder-shown:tracking-[0.15em] peer-not-placeholder-shown:uppercase peer-not-placeholder-shown:text-[#775a19]"
                >
                  Secure Password
                </label>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4e4639] hover:text-[#775a19] transition-colors p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    /* eye-off */
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    /* eye */
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>

              {/* Remember me + Forgot password */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <div className="relative flex items-center justify-center w-5 h-5">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="peer appearance-none w-5 h-5 border border-[#d1c5b4] rounded-sm checked:bg-[#775a19] checked:border-[#775a19] transition-all duration-200 cursor-pointer"
                    />
                    <svg
                      className="absolute h-3 w-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity duration-200"
                      viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <polyline points="2 6 5 9 10 3" />
                    </svg>
                  </div>
                  <span className="font-['Manrope'] text-sm text-[#4e4639] group-hover:text-[#1a1c1b] transition-colors">
                    Remember Me
                  </span>
                </label>
                <button
                  type="button"
                  className="font-['Manrope'] text-sm text-[#775a19] hover:text-[#c5a059] underline underline-offset-4 decoration-[#775a19]/30 hover:decoration-[#c5a059] transition-colors"
                >
                  Forgot Password?
                </button>
              </div>

              {/* Error */}
              {authError ? (
                <div className="flex items-start gap-3 bg-[#ffdad6] px-4 py-3 rounded-sm">
                  <AlertTriangle className="h-3.5 w-3.5 text-[#ba1a1a] mt-0.5 shrink-0" />
                  <p className="font-['Manrope'] text-xs text-[#ba1a1a]">{authError}</p>
                </div>
              ) : null}

              {/* Submit — gold gradient button */}
              <div className="pt-5">
                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full text-white font-['Manrope'] font-medium text-sm tracking-wider uppercase py-4 rounded-sm transition-opacity hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
                  style={{ background: 'linear-gradient(to right, #775a19, #c5a059)', boxShadow: '0 4px 16px rgba(119, 90, 25, 0.25)' }}
                >
                  {isLoggingIn ? 'Signing in…' : 'Access Dashboard'}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Footer */}
        <footer className="fixed bottom-0 w-full flex flex-col md:flex-row justify-between items-center px-12 py-6 z-20">
          <p className="font-['Manrope'] text-[10px] uppercase tracking-widest text-white/30 mb-3 md:mb-0">
            © 2025 Atelier Meridian. All rights reserved.
          </p>
          <div className="flex gap-6">
            {['Privacy Policy', 'Terms of Service', 'Support'].map((link) => (
              <button
                key={link}
                type="button"
                className="font-['Manrope'] text-[10px] uppercase tracking-widest text-white/30 hover:text-[#c5a059] underline underline-offset-4 transition-colors"
              >
                {link}
              </button>
            ))}
          </div>
        </footer>
      </div>
    );
  }

  /* ── Dashboard ── */
  return (
    <div className="min-h-screen bg-[#faf9f7] font-['Manrope'] text-[#1a1c1b]">
      <div className="flex min-h-screen">

        {/* ── Sidebar ── */}
        <aside className="hidden lg:flex fixed left-0 top-0 h-full w-64 flex-col bg-stone-100 py-10 z-50">
          <div className="px-8 mb-10">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded bg-[#1a1c1b]">
                <UtensilsCrossed className="h-4 w-4 text-[#c5a059]" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.25em] text-[#4e4639] font-semibold">Atelier Meridian</p>
                <p className="font-['Noto_Serif'] text-base text-[#1a1c1b] leading-tight">Admin</p>
              </div>
            </div>

            <div className="mt-6 bg-white rounded p-3 shadow-[0_4px_12px_rgba(26,28,27,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#1a1c1b] truncate">{identity.name}</p>
                  <p className="text-xs text-[#4e4639] truncate mt-0.5">{identity.username}</p>
                </div>
                <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] uppercase tracking-widest font-bold ${
                  identity.role === 'manager' ? 'bg-[#1a1c1b] text-white' : 'bg-[#ffdea5] text-[#775a19]'
                }`}>
                  {identity.role}
                </span>
              </div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto">
            <ul className="space-y-0.5">
              {navItems.map(({ id, label, icon: Icon, badge }) => {
                const isActive = activeTab === id;
                return (
                  <li key={id}>
                    <button
                      className={`flex w-full items-center justify-between py-4 pl-8 pr-5 text-left transition-all duration-150 font-['Manrope'] text-sm font-medium tracking-wide ${
                        isActive
                          ? 'bg-white text-[#775a19] rounded-l-full font-bold shadow-[0_4px_12px_rgba(26,28,27,0.04)]'
                          : 'text-stone-600 hover:bg-white/50'
                      }`}
                      onClick={() => setActiveTab(id)}
                      type="button"
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="h-4 w-4 text-[#775a19]" />
                        {label}
                      </span>
                      {badge ? (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                          isActive ? 'bg-[#775a19]/10 text-[#775a19]' : 'bg-[#ffdad6] text-[#93000a]'
                        }`}>
                          {badge}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="px-8 mt-6">
            <button
              className="w-full flex items-center justify-center gap-2 bg-transparent text-[#775a19] border border-[#d1c5b4]/50 py-3 rounded text-xs font-['Manrope'] uppercase tracking-widest font-semibold hover:bg-white/60 transition-colors"
              onClick={handleLogout} type="button"
            >
              <LogOut className="h-3.5 w-3.5" />
              Log Out
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <div className="flex-1 lg:ml-64 flex flex-col">

          {/* Top bar */}
          <header className="sticky top-0 z-40 bg-[#faf9f7]/80 backdrop-blur-md shadow-[0_4px_24px_rgba(26,28,27,0.04)] flex items-center justify-between px-6 lg:px-12 h-16">
            <div>
              <span className="text-[10px] uppercase tracking-[0.25em] text-[#4e4639] font-semibold">iPad Operations View</span>
              <h2 className="font-['Noto_Serif'] text-lg text-[#1a1c1b] leading-tight">
                {navItems.find((n) => n.id === activeTab)?.label}
              </h2>
            </div>

            <div className="hidden md:flex items-center gap-6">
              {slaBreachedCount > 0 ? (
                <div className="flex items-center gap-1.5 text-[#ba1a1a]">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="font-['Manrope'] text-xs font-semibold uppercase tracking-widest">
                    {slaBreachedCount} SLA
                  </span>
                </div>
              ) : null}
              {[
                { label: 'Incoming', value: unreadIncomingOrders.length },
                { label: 'Active', value: activeOrders.length },
                { label: 'Avg Rating', value: averageRating },
                { label: "Today's Rev", value: formatIdr(revenueSummary.kpi.revenue) },
              ].map((kpi) => (
                <div key={kpi.label} className="text-right">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#4e4639]">{kpi.label}</p>
                  <p className="font-['Noto_Serif'] text-base font-semibold text-[#1a1c1b]">{kpi.value}</p>
                </div>
              ))}
            </div>
          </header>

          <main className="flex-1 px-6 lg:px-12 py-8">

            {/* Notification banner */}
            {notificationMessage ? (
              <div className="mb-6 flex items-center justify-between bg-[#1a1c1b] px-5 py-3 rounded">
                <div className="flex items-center gap-3">
                  <Bell className="h-4 w-4 text-[#c5a059] shrink-0" />
                  <p className="font-['Manrope'] text-sm text-white">{notificationMessage}</p>
                </div>
                <button
                  className="text-white/60 hover:text-white text-xs font-['Manrope'] uppercase tracking-widest ml-4 shrink-0"
                  onClick={() => setNotificationMessage('')} type="button"
                >
                  Close
                </button>
              </div>
            ) : null}

            {/* ══════════════════════════════════════════
                LIVE ORDERS
            ══════════════════════════════════════════ */}
            {activeTab === 'orders' ? (
              <div className="space-y-4">
                {orders.length === 0 ? (
                  <div className="bg-white rounded p-8 text-center shadow-[0_8px_24px_rgba(26,28,27,0.03)]">
                    <p className="font-['Manrope'] text-sm text-[#4e4639]">No orders yet. Waiting for guest activity.</p>
                  </div>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {orders.map((order) => {
                      const sla = isOrderSlaBreached(order);
                      return (
                        <div
                          key={order.id}
                          className={`bg-white rounded shadow-[0_8px_24px_rgba(26,28,27,0.04)] overflow-hidden ${
                            sla
                              ? 'border-l-4 border-[#ba1a1a]'
                              : !order.isRead
                                ? 'border-l-4 border-[#775a19]'
                                : ''
                          }`}
                        >
                          {/* SLA warning strip */}
                          {sla ? (
                            <div className="flex items-center gap-2 bg-[#ffdad6] px-5 py-2">
                              <AlertTriangle className="h-3.5 w-3.5 text-[#ba1a1a] shrink-0" />
                              <p className="font-['Manrope'] text-xs font-semibold text-[#ba1a1a] uppercase tracking-widest">
                                SLA breached — order waiting &gt;20 min
                              </p>
                            </div>
                          ) : null}

                          {/* Order header */}
                          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-[#f4f3f1]">
                            <div>
                              <div className="flex items-center gap-2">
                                {!order.isRead && !sla ? (
                                  <span className="h-2 w-2 rounded-full bg-[#775a19] shrink-0" />
                                ) : null}
                                <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">Room {order.roomNumber}</h3>
                              </div>
                              <p className="mt-0.5 font-['Manrope'] text-xs text-[#4e4639]">
                                {order.createdAt ? order.createdAt.toLocaleString() : 'Unknown time'}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded px-2 py-0.5 font-['Manrope'] text-[10px] uppercase tracking-widest font-semibold ${STATUS_COLORS[order.status] || 'bg-[#e9e8e6] text-[#1a1c1b]'}`}>
                                {order.status.replaceAll('_', ' ')}
                              </span>
                              <span className="rounded px-2 py-0.5 font-['Manrope'] text-[10px] uppercase tracking-widest font-semibold bg-[#f4f3f1] text-[#4e4639]">
                                {formatIdr(order.total)}
                              </span>
                            </div>
                          </div>

                          {/* Order body */}
                          <div className="grid md:grid-cols-[1.2fr_0.8fr]">
                            <div className="p-5 bg-[#faf9f7] border-r border-[#f4f3f1]">
                              <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.18em] text-[#4e4639] font-semibold mb-3">Order Items</p>
                              <div className="space-y-3">
                                {order.items.map((item) => (
                                  <div key={item.id} className="flex items-start justify-between gap-2">
                                    <div>
                                      <p className="font-['Manrope'] text-sm font-semibold text-[#1a1c1b]">{item.qty}× {item.name}</p>
                                      {item.note ? <p className="mt-0.5 font-['Manrope'] text-xs text-[#4e4639] italic">"{item.note}"</p> : null}
                                    </div>
                                    <p className="font-['Manrope'] text-sm text-[#4e4639] shrink-0">{formatIdr(item.qty * item.price)}</p>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="p-5 flex flex-col gap-4">
                              <div>
                                <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.18em] text-[#4e4639] font-semibold mb-2">Guest</p>
                                <div className="space-y-1 font-['Manrope'] text-sm text-[#1a1c1b]">
                                  <p><span className="text-[#4e4639]">Name: </span>{order.lastName || '—'}</p>
                                  <p><span className="text-[#4e4639]">Phone: </span>{order.phoneNumber || '—'}</p>
                                  <p><span className="text-[#4e4639]">Payment: </span>{order.paymentMethod}</p>
                                  <p><span className="text-[#4e4639]">Rating: </span>{order.rating ? `${order.rating}/5` : 'Pending'}</p>
                                </div>
                                {(order.feedbackText || order.feedbackSummary) ? (
                                  <p className="mt-2 font-['Manrope'] text-xs text-[#4e4639] italic leading-5">
                                    "{order.feedbackText || order.feedbackSummary}"
                                  </p>
                                ) : null}
                              </div>

                              <div className="space-y-2">
                                <div className="relative">
                                  <select
                                    className="w-full appearance-none bg-[#f4f3f1] border-none rounded px-3 py-2 font-['Manrope'] text-sm text-[#1a1c1b] outline-none cursor-pointer"
                                    value={order.status}
                                    onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                                  >
                                    {ORDER_STATUSES.map((s) => (
                                      <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    className="flex-1 border border-[#d1c5b4]/50 text-[#4e4639] font-['Manrope'] text-xs uppercase tracking-widest py-2 rounded hover:bg-[#f4f3f1] transition-colors"
                                    onClick={() => markAsRead(order.id)} type="button"
                                  >
                                    Mark Read
                                  </button>
                                  {(order.accessTokenId || order.guestUid) ? (
                                    <button
                                      className="flex-1 border border-[#d1c5b4]/50 text-[#ba1a1a] font-['Manrope'] text-xs uppercase tracking-widest py-2 rounded hover:bg-[#ffdad6] transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                                      disabled={revokingSessionId === (order.accessTokenId || order.guestUid)}
                                      onClick={() => handleRevokeGuest(order.accessTokenId || order.guestUid)}
                                      type="button"
                                    >
                                      <ShieldBan className="h-3 w-3" />
                                      Revoke
                                    </button>
                                  ) : null}
                                </div>
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
              <div className="space-y-6">
                <div className="bg-white rounded p-5 shadow-[0_8px_24px_rgba(26,28,27,0.03)] flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold">Menu readiness</p>
                    <p className="mt-1.5 font-['Manrope'] text-sm leading-6 text-[#4e4639]">
                      Mark dishes as ready or unavailable, edit details, and remove items.
                    </p>
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#4e4639]" />
                      <input
                        className="bg-[#f4f3f1] border-none rounded pl-9 pr-4 py-2.5 font-['Manrope'] text-sm text-[#1a1c1b] outline-none placeholder:text-[#4e4639]/50 w-56"
                        placeholder="Search menu" value={menuSearch}
                        onChange={(e) => setMenuSearch(e.target.value)}
                      />
                    </div>
                    <button
                      className="flex items-center gap-2 bg-[#1a1c1b] text-white font-['Manrope'] text-xs uppercase tracking-widest font-semibold px-4 py-2.5 rounded hover:bg-[#1a1c1b]/90 transition-colors"
                      onClick={() => setEditingProduct(getEditorState())} type="button"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Item
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {filteredProducts.map((product) => (
                    <div key={product.id} className="bg-white rounded shadow-[0_8px_24px_rgba(26,28,27,0.03)] overflow-hidden">
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">{product.name}</h3>
                            <p className="font-['Manrope'] text-xs text-[#4e4639] mt-0.5">{product.category}</p>
                          </div>
                          <span className={`rounded px-2 py-0.5 font-['Manrope'] text-[10px] uppercase tracking-widest font-semibold shrink-0 ${
                            product.isAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-[#ffdad6] text-[#93000a]'
                          }`}>
                            {product.isAvailable ? 'Ready' : 'Unavailable'}
                          </span>
                        </div>
                        <p className="mt-3 font-['Manrope'] text-sm leading-6 text-[#4e4639]">{product.description}</p>
                        <div className="mt-3 bg-[#f4f3f1] px-4 py-2.5 rounded">
                          <p className="font-['Manrope'] text-[10px] uppercase tracking-widest text-[#4e4639]">Guest price</p>
                          <p className="font-['Noto_Serif'] text-base font-semibold text-[#775a19] mt-0.5">{formatIdr(product.price)}</p>
                        </div>
                        {product.unavailableReason ? (
                          <p className="mt-3 font-['Manrope'] text-xs text-[#ba1a1a] bg-[#ffdad6] px-3 py-2 rounded">
                            {product.unavailableReason}
                          </p>
                        ) : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            className={`font-['Manrope'] text-xs uppercase tracking-widest font-semibold px-3 py-2 rounded transition-colors ${
                              product.isAvailable
                                ? 'border border-[#d1c5b4]/50 text-[#4e4639] hover:bg-[#f4f3f1]'
                                : 'bg-[#775a19] text-white hover:bg-[#775a19]/90'
                            }`}
                            onClick={() => toggleProductAvailability(product)} type="button"
                          >
                            {product.isAvailable ? 'Set Unavailable' : 'Set Ready'}
                          </button>
                          <button
                            className="flex items-center gap-1 border border-[#d1c5b4]/50 text-[#4e4639] font-['Manrope'] text-xs uppercase tracking-widest font-semibold px-3 py-2 rounded hover:bg-[#f4f3f1] transition-colors"
                            onClick={() => setEditingProduct(getEditorState(product))} type="button"
                          >
                            <PencilLine className="h-3 w-3" />
                            Edit
                          </button>
                          <button
                            className="border border-[#d1c5b4]/50 text-[#ba1a1a] font-['Manrope'] text-xs uppercase tracking-widest font-semibold px-3 py-2 rounded hover:bg-[#ffdad6] transition-colors"
                            onClick={() => deleteProduct(product.id)} type="button"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* ══════════════════════════════════════════
                FEEDBACK
            ══════════════════════════════════════════ */}
            {activeTab === 'feedback' ? (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-3">
                  {[
                    { label: 'Feedback Entries', value: feedbackOrders.length },
                    { label: 'Needs Manager', value: needsReviewOrders.length },
                    { label: 'Average Rating', value: averageRating },
                  ].map((kpi) => (
                    <div key={kpi.label} className="bg-white rounded p-5 shadow-[0_8px_24px_rgba(26,28,27,0.03)]">
                      <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.18em] text-[#4e4639] font-semibold">{kpi.label}</p>
                      <p className="font-['Noto_Serif'] text-3xl text-[#1a1c1b] mt-2">{kpi.value}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  {feedbackOrders.map((order) => (
                    <div
                      key={`feedback-${order.id}`}
                      className={`bg-white rounded shadow-[0_8px_24px_rgba(26,28,27,0.03)] overflow-hidden ${
                        order.managerFollowUpRequested ? 'border-l-4 border-[#ba1a1a]' : ''
                      }`}
                    >
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-['Noto_Serif'] text-xl text-[#1a1c1b]">Room {order.roomNumber}</h3>
                            <p className="font-['Manrope'] text-xs text-[#4e4639] mt-0.5">
                              {order.createdAt ? order.createdAt.toLocaleString() : 'Unknown time'}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            {order.rating ? (
                              <span className={`rounded px-2 py-0.5 font-['Manrope'] text-[10px] uppercase tracking-widest font-semibold ${
                                order.rating <= 3 ? 'bg-[#ffdad6] text-[#93000a]' : 'bg-emerald-50 text-emerald-700'
                              }`}>
                                {order.rating} / 5
                              </span>
                            ) : null}
                            {order.managerFollowUpRequested ? (
                              <span className="rounded px-2 py-0.5 font-['Manrope'] text-[10px] uppercase tracking-widest font-semibold bg-[#1a1c1b] text-white">
                                Follow-up
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-4 bg-[#f4f3f1] p-4 rounded font-['Manrope'] text-sm leading-6 text-[#4e4639] italic">
                          "{order.feedbackText || order.feedbackSummary || 'Guest submitted a rating without written comments.'}"
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* ══════════════════════════════════════════
                REVENUE
            ══════════════════════════════════════════ */}
            {activeTab === 'revenue' ? (
              <ManagerOnly role={identity.role}>
                <div className="space-y-6">
                  <div className="bg-white rounded p-5 shadow-[0_8px_24px_rgba(26,28,27,0.03)] flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold">Daily revenue export</p>
                      <p className="mt-1.5 font-['Manrope'] text-sm leading-6 text-[#4e4639]">
                        Excel-compatible `.xls` export — open directly in Excel or Numbers.
                      </p>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                      <input
                        className="bg-[#f4f3f1] border-none rounded px-4 py-2.5 font-['Manrope'] text-sm text-[#1a1c1b] outline-none"
                        type="date" value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                      />
                      <button
                        className="bg-[#1a1c1b] text-white font-['Manrope'] text-xs uppercase tracking-widest font-semibold px-5 py-2.5 rounded hover:bg-[#1a1c1b]/90 transition-colors"
                        onClick={exportRevenue} type="button"
                      >
                        Export to Excel
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    {[
                      { label: 'Revenue', value: formatIdr(revenueSummary.kpi.revenue) },
                      { label: 'Completed Orders', value: revenueSummary.kpi.completedOrders },
                      { label: 'Cancelled Orders', value: revenueSummary.kpi.cancelledOrders },
                    ].map((kpi) => (
                      <div key={kpi.label} className="bg-white rounded p-5 shadow-[0_8px_24px_rgba(26,28,27,0.03)]">
                        <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.18em] text-[#4e4639] font-semibold">{kpi.label}</p>
                        <p className="font-['Noto_Serif'] text-3xl text-[#1a1c1b] mt-2">{kpi.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="bg-white rounded p-5 shadow-[0_8px_24px_rgba(26,28,27,0.03)]">
                    <h3 className="font-['Noto_Serif'] text-2xl text-[#1a1c1b] mb-4">Revenue Rows</h3>
                    <div className="space-y-2">
                      {revenueSummary.rows.map((row) => (
                        <div key={row.id} className="grid gap-3 bg-[#f4f3f1] px-4 py-3 rounded font-['Manrope'] text-sm text-[#4e4639] md:grid-cols-4">
                          <p><span className="text-[#1a1c1b] font-medium">Order: </span>{row.id.slice(0, 8)}…</p>
                          <p><span className="text-[#1a1c1b] font-medium">Room: </span>{row.roomNumber}</p>
                          <p><span className="text-[#1a1c1b] font-medium">Payment: </span>{row.paymentMethod}</p>
                          <p><span className="text-[#775a19] font-semibold">{formatIdr(row.total)}</span></p>
                        </div>
                      ))}
                      {revenueSummary.rows.length === 0 ? (
                        <div className="bg-[#f4f3f1] rounded p-6 font-['Manrope'] text-sm text-[#4e4639] text-center">
                          No completed revenue rows for the selected date.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </ManagerOnly>
            ) : null}

            {/* ══════════════════════════════════════════
                SHIFT HANDOVER NOTES
            ══════════════════════════════════════════ */}
            {activeTab === 'handover' ? (
              <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                {/* Compose note */}
                <div className="bg-white rounded p-6 shadow-[0_8px_24px_rgba(26,28,27,0.03)]">
                  <div className="flex items-center gap-3 mb-5">
                    <BookOpen className="h-5 w-5 text-[#775a19]" />
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
                              activeShift === s
                                ? 'bg-[#1a1c1b] text-white'
                                : 'border border-[#d1c5b4]/50 text-[#4e4639] hover:bg-[#f4f3f1]'
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
                        className="w-full bg-[#f4f3f1] border-none rounded px-4 py-3 font-['Manrope'] text-sm text-[#1a1c1b] outline-none resize-none min-h-[140px] placeholder:text-[#4e4639]/50"
                        placeholder="e.g. Suite 402 guest requires dairy-free options. Fryer #2 is under maintenance until 18:00."
                        value={handoverDraft}
                        onChange={(e) => setHandoverDraft(e.target.value)}
                      />
                    </div>

                    <button
                      className="w-full bg-[#775a19] text-white font-['Manrope'] text-xs uppercase tracking-widest font-semibold py-3 rounded hover:bg-[#775a19]/90 transition-colors shadow-[0_4px_14px_rgba(119,90,25,0.2)] disabled:opacity-50"
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
                      <div key={s} className="bg-white rounded p-5 shadow-[0_8px_24px_rgba(26,28,27,0.03)]">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold">{s}</p>
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
                              <div key={note.id} className="bg-[#f4f3f1] rounded p-4">
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
            ) : null}

            {/* ══════════════════════════════════════════
                SETTINGS
            ══════════════════════════════════════════ */}
            {activeTab === 'settings' ? (
              <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="bg-white rounded p-6 shadow-[0_8px_24px_rgba(26,28,27,0.03)]">
                  <div className="flex items-center gap-3 mb-6">
                    <QrCode className="h-5 w-5 text-[#775a19]" />
                    <h3 className="font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Guest QR Access</h3>
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-5">
                      {[
                        { label: 'Hotel ID', value: hotelId, onChange: setHotelId, placeholder: '' },
                        { label: 'Stay ID', value: stayId, onChange: setStayId, placeholder: 'stay-1204-demo' },
                        { label: 'Room Number', value: roomNumber, onChange: setRoomNumber, placeholder: '1204' },
                        { label: 'Expiry (minutes)', value: expiresInMinutes, onChange: setExpiresInMinutes, placeholder: '720' },
                      ].map((field) => (
                        <UnderlineInput
                          key={field.label} id={field.label} label={field.label}
                          value={field.value} placeholder={field.placeholder} onChange={field.onChange}
                        />
                      ))}

                      <div className="flex flex-wrap gap-3 pt-2">
                        <button
                          className="bg-[#1a1c1b] text-white font-['Manrope'] text-xs uppercase tracking-widest font-semibold px-5 py-3 rounded hover:bg-[#1a1c1b]/90 transition-colors disabled:opacity-50"
                          disabled={isGeneratingToken} onClick={handleGenerateQr} type="button"
                        >
                          {isGeneratingToken ? 'Generating…' : 'Generate QR'}
                        </button>
                        {tokenResult?.qrUrl ? (
                          <button
                            className="flex items-center gap-2 border border-[#d1c5b4]/50 text-[#4e4639] font-['Manrope'] text-xs uppercase tracking-widest font-semibold px-5 py-3 rounded hover:bg-[#f4f3f1] transition-colors"
                            onClick={copyTokenUrl} type="button"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy URL
                          </button>
                        ) : null}
                      </div>
                      {tokenStatus ? <p className="font-['Manrope'] text-xs text-[#4e4639]">{tokenStatus}</p> : null}
                    </div>

                    <div className="bg-[#f4f3f1] rounded p-5">
                      <p className="font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold mb-4">Print Pack</p>
                      {tokenResult ? (
                        <div className="space-y-4 font-['Manrope'] text-sm">
                          {[
                            { label: 'Guest URL', value: tokenResult.qrUrl, mono: true },
                            { label: 'Raw Token', value: tokenResult.rawToken, mono: true },
                            { label: 'Expires At', value: new Date(tokenResult.expiresAt).toLocaleString(), mono: false },
                          ].map((item) => (
                            <div key={item.label}>
                              <p className="font-['Manrope'] text-[10px] uppercase tracking-widest text-[#4e4639]">{item.label}</p>
                              <p className={`mt-1.5 bg-white rounded px-3 py-2 text-xs text-[#1a1c1b] leading-5 break-all ${item.mono ? 'font-mono' : ''}`}>
                                {item.value}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="font-['Manrope'] text-sm leading-6 text-[#4e4639]">
                          Generate a guest access link for the front-office print workflow.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-white rounded p-6 shadow-[0_8px_24px_rgba(26,28,27,0.03)]">
                    <div className="flex items-center gap-3 mb-4">
                      <UserCircle2 className="h-5 w-5 text-[#775a19]" />
                      <h3 className="font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Active Operator</h3>
                    </div>
                    <div className="bg-[#f4f3f1] rounded p-4 font-['Manrope'] text-sm space-y-2">
                      <p className="text-[#4e4639]">Name: <span className="font-semibold text-[#1a1c1b]">{identity.name}</span></p>
                      <p className="text-[#4e4639]">Role: <span className="font-semibold text-[#1a1c1b]">{identity.role}</span></p>
                      <p className="text-[#4e4639]">Credential: <span className="font-semibold text-[#1a1c1b]">{identity.username}</span></p>
                    </div>
                  </div>

                  <div className="bg-white rounded p-6 shadow-[0_8px_24px_rgba(26,28,27,0.03)]">
                    <div className="flex items-center gap-3 mb-4">
                      <Sparkles className="h-5 w-5 text-[#775a19]" />
                      <h3 className="font-['Noto_Serif'] text-2xl text-[#1a1c1b]">Audit Trail</h3>
                    </div>
                    <p className="font-['Manrope'] text-sm text-[#4e4639] leading-6">
                      Every write action (order status changes, menu edits, availability toggles, guest session revokes, shift notes) is logged to the{' '}
                      <code className="bg-[#f4f3f1] px-1.5 py-0.5 rounded text-xs text-[#1a1c1b]">auditLog</code>
                      {' '}collection in Firestore with operator name, role, and timestamp.
                    </p>
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
                <label className="block font-['Manrope'] text-[10px] uppercase tracking-[0.2em] text-[#4e4639] font-semibold mb-2">
                  Description
                </label>
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
    </div>
  );
}
