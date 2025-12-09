import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from '../../lib/firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, query, orderBy, Timestamp } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { toast } from 'sonner@2.0.3';
import { Toaster } from '../ui/sonner';
import { useWakeLock } from '../../hooks/useWakeLock';
import { useDynamicTitle } from '../../hooks/useDynamicTitle';
import { 
  Bell, 
  Utensils, 
  BarChart, 
  Settings, 
  LogOut, 
  Plus, 
  Edit2, 
  Trash2, 
  CheckCircle, 
  Clock, 
  Lock,
  Users,
  Store,
  TrendingUp,
  DollarSign,
  AlertCircle,
  X,
  Eye,
  Download,
  FileText,
  ChevronLeft,
  ChevronRight,
  Star
} from 'lucide-react';
import { 
  BarChart as RechartsBarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

// --- Types ---

type Role = 'manager' | 'staff';

interface User {
  id: string;
  username: string;
  pin: string;
  role: Role;
  name: string;
}

interface MenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
  image: string;
  description?: string;
  isAvailable: boolean;
}

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  note?: string;
}

interface Order {
  id: string;
  roomNumber: string;
  status: 'incoming' | 'kitchen' | 'completed' | 'cancelled';
  items: OrderItem[];
  createdAt: any; // Firestore Timestamp
  total: number;
  paymentMethod: 'room' | 'qris' | 'bank';
  paymentProofUrl?: string;
  isRead: boolean;
  rating?: number;
  feedback?: string;
}

interface AppSettings {
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  taxPercentage: number;
  storeOpen: boolean;
}

// --- Mock Data ---

const MOCK_USERS: User[] = [
  { id: '1', username: 'admin', pin: '1234', role: 'manager', name: 'Mr. Manager' },
  { id: '2', username: 'staff', pin: '0000', role: 'staff', name: 'Staff A' }
];

// --- Helper Components ---

const StatusToggle = ({ isAvailable, onToggle }: { isAvailable: boolean; onToggle: () => void }) => (
  <button 
    onClick={onToggle}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${isAvailable ? 'bg-green-500' : 'bg-slate-300'}`}
  >
    <span className="sr-only">Toggle availability</span>
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isAvailable ? 'translate-x-6' : 'translate-x-1'}`}
    />
  </button>
);

const PriceFormatter = ({ price }: { price: number }) => (
  <span>
    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(price)}
  </span>
);

const RestrictedAccess = () => (
  <div className="flex flex-col items-center justify-center h-full text-slate-400">
    <div className="bg-slate-100 p-6 rounded-full mb-4">
      <Lock size={48} className="text-slate-400" />
    </div>
    <h3 className="font-serif text-xl font-bold text-slate-700 mb-2">Access Restricted</h3>
    <p className="text-slate-500 max-w-sm text-center">
      You do not have permission to view this section. Please contact your manager if you believe this is an error.
    </p>
  </div>
);

// --- View Components ---

const LoginScreen = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      console.error("Login failed", err);
      setError('Login failed. Please check your credentials.');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
        <div className="flex justify-center mb-8">
          <img 
            src="https://i.ibb.co.com/c5fhDh6/The-Gallery-Restaurant.png" 
            alt="Hotel Ciputra" 
            className="h-24 w-auto object-contain drop-shadow-md"
          />
        </div>
        
        <h2 className="text-2xl font-serif font-bold text-center text-slate-900 mb-2">Welcome Back</h2>
        <p className="text-center text-slate-500 mb-8">Enter your email and password to access the House App</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Email Address</label>
            <Input 
              type="email" 
              placeholder="admin@hotel.com" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 bg-slate-50"
              required
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Password</label>
            <Input 
              type="password" 
              placeholder="••••••••" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 bg-slate-50"
              required
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <Button 
            type="submit" 
            disabled={loading}
            className="w-full h-11 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-xl text-base mt-2"
          >
            {loading ? 'Signing in...' : 'Enter Dashboard'}
          </Button>
        </form>
      </div>
    </div>
  );
};

const MenuManager = () => {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newItem, setNewItem] = useState<Partial<MenuItem>>({
    name: '',
    category: 'Main Course',
    price: 0,
    description: '',
    image: '',
    isAvailable: true
  });

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "products"), (snapshot) => {
      const fetchedItems = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      })) as MenuItem[];
      setItems(fetchedItems);
    });
    return () => unsubscribe();
  }, []);

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, "products", id), { isAvailable: !currentStatus });
    } catch (error) {
      console.error('Error toggling status:', error);
      toast.error('Failed to update status');
    }
  };

  const deleteItem = async (id: string) => {
    try {
      if (confirm('Are you sure you want to delete this item?')) {
        await deleteDoc(doc(db, "products", id));
        toast.success('Item deleted');
      }
    } catch (error) {
      console.error('Error deleting item:', error);
      toast.error('Failed to delete item');
    }
  };

  const handleSaveItem = async () => {
    if (!newItem.name || !newItem.price) {
      toast.error('Please fill in name and price');
      return;
    }
    
    try {
      const itemData = {
        name: newItem.name,
        category: newItem.category || 'Main Course',
        price: Number(newItem.price),
        description: newItem.description || '',
        image: newItem.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&q=80&w=200',
      };

      if (newItem.id) {
        await updateDoc(doc(db, "products", newItem.id), itemData);
        toast.success('Item updated successfully');
      } else {
        await addDoc(collection(db, "products"), {
          ...itemData,
          isAvailable: true,
          createdAt: new Date()
        });
        toast.success('Item created successfully');
      }

      setIsAddModalOpen(false);
      setNewItem({ name: '', category: 'Main Course', price: 0, description: '', image: '', isAvailable: true });
    } catch (error) {
      console.error('Error saving item:', error);
      toast.error('Failed to save item');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-serif font-bold text-slate-900">All Menu Items</h2>
          <p className="text-slate-500 mt-1">Manage your food and beverage catalog</p>
        </div>
        <button 
          onClick={() => {
            setNewItem({ name: '', category: 'Main Course', price: 0, description: '', image: '', isAvailable: true });
            setIsAddModalOpen(true);
          }}
          className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-xl transition-colors font-medium shadow-md shadow-orange-200"
        >
          <Plus size={18} />
          Add New Menu
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 font-semibold text-slate-700 font-serif">Product Info</th>
                <th className="px-6 py-4 font-semibold text-slate-700 font-serif">Price</th>
                <th className="px-6 py-4 font-semibold text-slate-700 font-serif">Status</th>
                <th className="px-6 py-4 font-semibold text-slate-700 font-serif text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <img 
                        src={item.image} 
                        alt={item.name} 
                        className="h-12 w-12 rounded-lg object-cover shadow-xs"
                      />
                      <div>
                        <div className="font-bold text-slate-900">{item.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{item.category}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-700">
                    <PriceFormatter price={item.price} />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <StatusToggle 
                        isAvailable={item.isAvailable} 
                        onToggle={() => toggleStatus(item.id, item.isAvailable)} 
                      />
                      <span className={`text-xs font-medium ${item.isAvailable ? 'text-green-700 bg-green-50 px-2 py-1 rounded-md' : 'text-red-700 bg-red-50 px-2 py-1 rounded-md'}`}>
                        {item.isAvailable ? 'Available' : 'Sold Out'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => {
                          setNewItem(item);
                          setIsAddModalOpen(true);
                        }}
                        className="p-2 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => deleteItem(item.id)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Menu Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold font-serif">Add New Menu Item</h3>
              <button onClick={() => setIsAddModalOpen(false)}><X size={20} className="text-slate-400" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Item Name</label>
                <Input value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} placeholder="e.g. Seafood Fried Rice" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1">Category</label>
                  <select 
                    className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white text-sm"
                    value={newItem.category}
                    onChange={e => setNewItem({...newItem, category: e.target.value})}
                  >
                    <option value="Main Course">Main Course</option>
                    <option value="Appetizer">Appetizer</option>
                    <option value="Western">Western</option>
                    <option value="Beverage">Beverage</option>
                    <option value="Dessert">Dessert</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1">Price (IDR)</label>
                  <Input 
                    type="number"
                    value={newItem.price} 
                    onChange={e => setNewItem({...newItem, price: Number(e.target.value)})} 
                    placeholder="e.g. 50000" 
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Description</label>
                <textarea 
                  className="w-full p-3 bg-white border border-slate-200 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                  rows={3}
                  value={newItem.description}
                  onChange={e => setNewItem({...newItem, description: e.target.value})}
                  placeholder="Describe the dish..."
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Image URL</label>
                <Input value={newItem.image} onChange={e => setNewItem({...newItem, image: e.target.value})} placeholder="https://..." />
                <p className="text-xs text-slate-400 mt-1">Paste a valid image URL for the thumbnail.</p>
              </div>

              <div className="pt-4 flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setIsAddModalOpen(false)}>Cancel</Button>
                <Button onClick={handleSaveItem} className="flex-1 bg-orange-600 hover:bg-orange-700 text-white">Save Item</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const LiveOrders = ({ orders }: { orders: Order[] }) => {
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  const moveOrder = async (id: string, newStatus: Order['status']) => {
    try {
      await updateDoc(doc(db, "orders", id), { status: newStatus });
      toast.success(`Order status updated to ${newStatus}`);
    } catch (error) {
      console.error("Failed to update status", error);
      toast.error("Failed to update order status");
    }
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  };

  const IncomingColumn = orders.filter(o => o.status === 'incoming');
  const KitchenColumn = orders.filter(o => o.status === 'kitchen');
  const HistoryColumn = orders.filter(o => {
    if (o.status !== 'completed') return false;
    let date: Date | null = null;
    if (o.createdAt?.toDate) date = o.createdAt.toDate();
    else if (o.createdAt) date = new Date(o.createdAt);
    return date ? isToday(date) : false;
  });

  const handleDownloadProof = () => {
    if (proofUrl) {
      const link = document.createElement('a');
      link.href = proofUrl;
      link.download = 'payment-proof.jpg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const formatTime = (timestamp: any) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diff = (new Date().getTime() - date.getTime()) / 60000;
    
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${Math.floor(diff)} mins ago`;
    return `${Math.floor(diff / 60)} hours ago`;
  };

  const OrderCard = ({ order, showActions = false, isHistory = false }: { order: Order, showActions?: boolean, isHistory?: boolean }) => (
    <motion.div 
      layoutId={order.id}
      className={`bg-white p-5 rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow mb-4 ${isHistory ? 'opacity-60' : ''}`}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-serif font-bold text-slate-900">Room {order.roomNumber}</h3>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
            <Clock size={12} />
            {formatTime(order.createdAt)}
          </div>
        </div>
        <div className="text-right">
          <div className="font-bold text-orange-600 text-sm">
            <PriceFormatter price={order.total} />
          </div>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${order.paymentMethod === 'room' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
            {order.paymentMethod}
          </span>
        </div>
      </div>

      <div className="space-y-2 mb-4 border-t border-dashed border-slate-100 pt-3">
        {order.items.map((item, i) => (
          <div key={i} className="flex flex-col text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600"><span className="font-semibold text-slate-900">{item.quantity}x</span> {item.name}</span>
            </div>
            {item.note && (
              <span className="text-xs text-orange-600 italic mt-0.5">"{item.note}"</span>
            )}
          </div>
        ))}
      </div>

      {order.paymentMethod !== 'room' && order.paymentProofUrl && (
        <div className="mb-4">
          <button 
            onClick={() => setProofUrl(order.paymentProofUrl!)}
            className="w-full flex items-center justify-center gap-2 text-xs font-bold text-slate-600 bg-slate-100 py-2 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <Eye size={14} /> View Payment Proof
          </button>
        </div>
      )}

      {showActions && (
        <div className="pt-3 border-t border-slate-100 flex gap-2">
          {order.status === 'incoming' && (
            <button 
              onClick={() => moveOrder(order.id, 'kitchen')}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              Accept Order
            </button>
          )}
          {order.status === 'kitchen' && (
            <button 
              onClick={() => moveOrder(order.id, 'completed')}
              className="w-full bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle size={16} />
              Mark Ready
            </button>
          )}
        </div>
      )}
    </motion.div>
  );

  return (
    <>
      <div className="h-full flex gap-6 overflow-x-auto pb-4">
        {/* Column 1: Incoming */}
        <div className="flex-1 min-w-[300px]">
          <div className="flex items-center justify-between mb-4 px-1">
            <h3 className="font-serif font-bold text-slate-800 flex items-center gap-2">
              Incoming
              <span className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full font-sans font-bold">{IncomingColumn.length}</span>
            </h3>
          </div>
          <div className="bg-slate-100/50 p-3 rounded-2xl min-h-[500px]">
            {IncomingColumn.map(order => (
              <OrderCard key={order.id} order={order} showActions />
            ))}
          </div>
        </div>

        {/* Column 2: Kitchen */}
        <div className="flex-1 min-w-[300px]">
          <div className="flex items-center justify-between mb-4 px-1">
            <h3 className="font-serif font-bold text-slate-800 flex items-center gap-2">
              Kitchen
              <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-sans font-bold">{KitchenColumn.length}</span>
            </h3>
          </div>
          <div className="bg-slate-100/50 p-3 rounded-2xl min-h-[500px]">
            {KitchenColumn.map(order => (
              <OrderCard key={order.id} order={order} showActions />
            ))}
          </div>
        </div>

        {/* Column 3: History (Completed Today) */}
        <div className="flex-1 min-w-[300px]">
          <div className="flex items-center justify-between mb-4 px-1">
            <h3 className="font-serif font-bold text-slate-400 flex items-center gap-2">
              History <span className="text-xs font-normal">(Today)</span>
            </h3>
          </div>
          <div className="bg-slate-50 border-2 border-dashed border-slate-200 p-3 rounded-2xl min-h-[500px]">
            {HistoryColumn.map(order => (
              <OrderCard key={order.id} order={order} isHistory />
            ))}
          </div>
        </div>
      </div>

      {/* Payment Proof Modal */}
      {proofUrl && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setProofUrl(null)}>
          <div className="bg-white rounded-2xl p-2 max-w-2xl w-full relative" onClick={e => e.stopPropagation()}>
            <div className="absolute top-4 right-4 flex gap-2">
              <button 
                onClick={handleDownloadProof}
                className="bg-white/90 p-2 rounded-full text-slate-700 hover:text-green-600 shadow-sm"
              >
                <Download size={20} />
              </button>
              <button onClick={() => setProofUrl(null)} className="bg-white/90 p-2 rounded-full text-slate-700 hover:text-red-600 shadow-sm">
                <X size={20} />
              </button>
            </div>
            <img src={proofUrl} alt="Payment Proof" className="w-full h-auto rounded-xl max-h-[80vh] object-contain bg-slate-100" />
            <div className="p-4 text-center">
              <p className="font-bold text-slate-700">Payment Proof</p>
              <p className="text-xs text-slate-500">Verify the transfer amount and details</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const ReviewsView = ({ orders }: { orders: Order[] }) => {
  const reviews = useMemo(() => {
    return orders
      .filter(o => (o.rating || 0) > 0)
      .sort((a, b) => {
         const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
         const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
         return dateB.getTime() - dateA.getTime();
      });
  }, [orders]);

  const averageRating = useMemo(() => {
    if (reviews.length === 0) return 0;
    const total = reviews.reduce((acc, curr) => acc + (curr.rating || 0), 0);
    return (total / reviews.length).toFixed(1);
  }, [reviews]);

  const StarRating = ({ rating }: { rating: number }) => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star 
          key={star} 
          size={14} 
          className={star <= rating ? "fill-yellow-400 text-yellow-400" : "text-slate-300"} 
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* KPI Header */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
            <div>
                <p className="text-slate-500 text-sm font-medium">Average Rating</p>
                <div className="flex items-center gap-3 mt-1">
                    <span className="text-3xl font-bold text-slate-900">{averageRating}</span>
                    <StarRating rating={Math.round(Number(averageRating))} />
                </div>
            </div>
            <div className="h-12 w-12 bg-yellow-50 rounded-full flex items-center justify-center text-yellow-600">
                <Star size={24} className="fill-current" />
            </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
            <div>
                <p className="text-slate-500 text-sm font-medium">Total Reviews</p>
                 <div className="flex items-center gap-3 mt-1">
                    <span className="text-3xl font-bold text-slate-900">{reviews.length}</span>
                </div>
            </div>
             <div className="h-12 w-12 bg-blue-50 rounded-full flex items-center justify-center text-blue-600">
                <Users size={24} />
            </div>
        </div>
      </div>

      {/* Reviews List */}
      <div>
        <h3 className="text-lg font-serif font-bold text-slate-900 mb-4">Recent Feedback</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reviews.map(review => (
                <div key={review.id} className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
                    <div className="flex justify-between items-start mb-3">
                        <div>
                            <div className="font-bold text-slate-900">Room {review.roomNumber}</div>
                            <div className="text-xs text-slate-500">
                                {review.createdAt?.toDate ? review.createdAt.toDate().toLocaleDateString() : 'Unknown Date'}
                            </div>
                        </div>
                        <StarRating rating={review.rating || 0} />
                    </div>
                    
                    <p className="text-sm text-slate-600 mb-4 bg-slate-50 p-3 rounded-lg italic">
                        "{review.feedback || "No comment provided"}"
                    </p>

                    <div className="text-xs text-slate-500 border-t border-slate-50 pt-3">
                        <span className="font-medium">Ordered:</span> {review.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                    </div>
                </div>
            ))}
            {reviews.length === 0 && (
                <div className="col-span-full text-center py-12 text-slate-400">
                    No reviews yet.
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

const SalesReport = ({ user, orders }: { user: User, orders: Order[] }) => {
  if (user.role !== 'manager') return <RestrictedAccess />;

  const [timeFilter, setTimeFilter] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Compute Dashboard Data
  const dashboardData = useMemo(() => {
    if (!orders.length) return { 
      kpi: { revenue: 0, count: 0, avg: 0, cancelled: 0 }, 
      chart: [],
      topItems: [] 
    };

    // 1. Define Filter Range
    const start = new Date(selectedDate);
    const end = new Date(selectedDate);
    
    // Normalize to start of day
    start.setHours(0,0,0,0);
    end.setHours(23,59,59,999);

    if (timeFilter === 'weekly') {
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff);
      end.setDate(start.getDate() + 6);
    } else if (timeFilter === 'monthly') {
      start.setDate(1);
      end.setMonth(start.getMonth() + 1, 0);
    } else if (timeFilter === 'yearly') {
      start.setMonth(0, 1);
      end.setMonth(11, 31);
    }

    // 2. Filter Orders
    const filteredOrders = orders.filter(o => {
      let date: Date;
      if (o.createdAt?.toDate) {
        date = o.createdAt.toDate();
      } else if (o.createdAt) {
        date = new Date(o.createdAt);
      } else {
        return false;
      }
      return date >= start && date <= end;
    });

    // 3. Calculate KPIs
    let revenue = 0;
    let count = 0;
    let cancelled = 0;
    const itemMap = new Map<string, number>();

    filteredOrders.forEach(o => {
      if (o.status === 'cancelled') {
        cancelled++;
      } else {
        revenue += (Number(o.total) || 0);
        count++;

        if (o.items && Array.isArray(o.items)) {
          o.items.forEach((item: any) => {
            const current = itemMap.get(item.name) || 0;
            itemMap.set(item.name, current + (item.quantity || 1));
          });
        }
      }
    });

    const avg = count > 0 ? revenue / count : 0;

    // 4. Prepare Chart Data
    const chartMap = new Map<string, number>();
    
    if (timeFilter === 'daily') {
      for(let i=0; i<24; i++) chartMap.set(i.toString().padStart(2, '0') + ':00', 0);
    } else if (timeFilter === 'weekly') {
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(d => chartMap.set(d, 0));
    } else if (timeFilter === 'monthly') {
      for(let i=1; i<=31; i++) chartMap.set(i.toString(), 0);
    } else {
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].forEach(m => chartMap.set(m, 0));
    }

    filteredOrders.forEach(o => {
      if (o.status === 'cancelled') return;
      
      let date: Date;
      if (o.createdAt?.toDate) date = o.createdAt.toDate();
      else if (o.createdAt) date = new Date(o.createdAt);
      else return;

      const val = (Number(o.total) || 0);
      let key = '';

      if (timeFilter === 'daily') {
        key = date.getHours().toString().padStart(2, '0') + ':00';
      } else if (timeFilter === 'weekly') {
        key = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
      } else if (timeFilter === 'monthly') {
        key = date.getDate().toString();
      } else {
        key = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date);
      }

      if (chartMap.has(key)) {
        chartMap.set(key, chartMap.get(key)! + val);
      }
    });

    const chart = Array.from(chartMap.entries()).map(([label, value]) => ({ label, value }));

    // 5. Top Items
    const topItems = Array.from(itemMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
      
    const maxCount = topItems.length > 0 ? topItems[0].count : 1;
    const topItemsWithPct = topItems.map(i => ({ ...i, pct: (i.count / maxCount) * 100 }));

    return {
      kpi: { revenue, count, avg, cancelled },
      chart,
      topItems: topItemsWithPct
    };
  }, [orders, timeFilter, selectedDate]);

  const kpiCards = [
    { label: 'Total Revenue', value: dashboardData.kpi.revenue, icon: DollarSign, color: 'text-green-600', isMoney: true },
    { label: 'Orders', value: dashboardData.kpi.count, icon: Utensils, color: 'text-orange-600' },
    { label: 'Avg Ticket', value: dashboardData.kpi.avg, icon: TrendingUp, color: 'text-red-600', isMoney: true },
    { label: 'Cancelled', value: dashboardData.kpi.cancelled, icon: AlertCircle, color: 'text-slate-500' },
  ];

  const handlePrevDate = () => {
    const d = new Date(selectedDate);
    if (timeFilter === 'daily') d.setDate(d.getDate() - 1);
    else if (timeFilter === 'weekly') d.setDate(d.getDate() - 7);
    else if (timeFilter === 'monthly') d.setMonth(d.getMonth() - 1);
    else d.setFullYear(d.getFullYear() - 1);
    setSelectedDate(d);
  };

  const handleNextDate = () => {
    const d = new Date(selectedDate);
    if (timeFilter === 'daily') d.setDate(d.getDate() + 1);
    else if (timeFilter === 'weekly') d.setDate(d.getDate() + 7);
    else if (timeFilter === 'monthly') d.setMonth(d.getMonth() + 1);
    else d.setFullYear(d.getFullYear() + 1);
    setSelectedDate(d);
  };

  const formatDateLabel = () => {
    if (timeFilter === 'daily') return selectedDate.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' });
    if (timeFilter === 'yearly') return selectedDate.getFullYear().toString();
    if (timeFilter === 'monthly') return selectedDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    return `Week of ${selectedDate.toLocaleDateString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-slate-900">Sales Overview</h2>
          <p className="text-slate-500 text-sm">Real-time performance from Firestore</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="bg-white border border-slate-200 rounded-lg flex p-1 shadow-sm">
            {['daily', 'weekly', 'monthly', 'yearly'].map((t) => (
              <button
                key={t}
                onClick={() => setTimeFilter(t as any)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold capitalize transition-all ${
                  timeFilter === t 
                    ? 'bg-slate-900 text-white shadow-sm' 
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex items-center bg-white border border-slate-200 rounded-lg shadow-sm h-9">
            <button onClick={handlePrevDate} className="px-2 hover:bg-slate-50 h-full rounded-l-lg border-r border-slate-100 text-slate-500">
              <ChevronLeft size={16} />
            </button>
            <div className="px-4 text-xs font-bold text-slate-700 min-w-[120px] text-center">
              {formatDateLabel()}
            </div>
            <button onClick={handleNextDate} className="px-2 hover:bg-slate-50 h-full rounded-r-lg border-l border-slate-100 text-slate-500">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((kpi, index) => (
          <div key={index} className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-slate-50 rounded-lg text-slate-600">
                <kpi.icon size={20} />
              </div>
            </div>
            <h4 className="text-sm font-medium text-slate-500 mb-1">{kpi.label}</h4>
            <div className="text-2xl font-bold text-slate-900">
              {kpi.isMoney 
                ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(kpi.value)
                : kpi.value
              }
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-serif font-bold text-slate-900 capitalize">Revenue Trend</h3>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart data={dashboardData.chart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="label" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 12 }} 
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 12 }} 
                  tickFormatter={(value) => `Rp${value/1000}k`}
                />
                <Tooltip 
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(value)}
                />
                <Bar 
                  dataKey="value" 
                  fill="#ea580c" 
                  radius={[4, 4, 0, 0]} 
                  maxBarSize={50}
                  animationDuration={500}
                />
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-serif font-bold text-slate-900 mb-6">Top Selling Items</h3>
          <div className="space-y-6">
            {dashboardData.topItems.length > 0 ? (
              dashboardData.topItems.map((item, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-medium text-slate-700 truncate pr-4">{item.name}</span>
                    <span className="text-slate-500 shrink-0">{item.count} orders</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-orange-500 rounded-full transition-all duration-500" 
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-slate-400 py-8 text-sm">
                No sales data for this period
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const SettingsView = ({ user, settings, setSettings }: { user: User, settings: AppSettings, setSettings: (s: AppSettings) => void }) => {
  const [users, setUsers] = useState(MOCK_USERS);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', username: '', pin: '', role: 'staff' as Role });

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name || !newUser.username || !newUser.pin) return;
    
    setUsers([...users, { ...newUser, id: Math.random().toString() }]);
    setShowAddUser(false);
    setNewUser({ name: '', username: '', pin: '', role: 'staff' });
    toast.success('User added successfully');
  };

  const deleteUser = (id: string) => {
    setUsers(users.filter(u => u.id !== id));
    toast.success('User removed');
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <h2 className="text-2xl font-serif font-bold text-slate-900">Settings</h2>

      {/* Section 1: User Profile (All Users) */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Users size={20} className="text-orange-600" />
          My Profile
        </h3>
        <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
          <div className="h-12 w-12 bg-slate-200 rounded-full flex items-center justify-center text-slate-500 font-bold text-xl">
            {user.username[0].toUpperCase()}
          </div>
          <div>
            <div className="font-bold text-slate-900">{user.name}</div>
            <div className="text-sm text-slate-500 capitalize">{user.role} Account</div>
          </div>
          <Button variant="outline" className="ml-auto">Change PIN</Button>
        </div>
      </div>

      {/* Section 2: User Management (Manager Only) */}
      {user.role === 'manager' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Lock size={20} className="text-orange-600" />
              User Management
            </h3>
            <Button onClick={() => setShowAddUser(true)} className="bg-slate-900 text-white hover:bg-slate-800">
              <Plus size={16} className="mr-2" /> Add User
            </Button>
          </div>

          <table className="w-full text-sm text-left">
            <thead className="text-slate-500 border-b border-slate-100">
              <tr>
                <th className="pb-3 pl-2">Name</th>
                <th className="pb-3">Username</th>
                <th className="pb-3">Role</th>
                <th className="pb-3">PIN</th>
                <th className="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {users.map(u => (
                <tr key={u.id} className="group">
                  <td className="py-3 pl-2 font-medium text-slate-900">{u.name}</td>
                  <td className="py-3 text-slate-500">{u.username}</td>
                  <td className="py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${u.role === 'manager' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 font-mono text-slate-400">••••</td>
                  <td className="py-3 text-right">
                    <button 
                      onClick={() => deleteUser(u.id)}
                      disabled={u.id === user.id}
                      className="text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-slate-400"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Section 3: App Settings */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
          <Store size={20} className="text-orange-600" />
          App Configuration
        </h3>
        <div className="space-y-6">
           <div className="flex items-center justify-between pb-6 border-b border-slate-50">
            <div>
              <div className="font-medium text-slate-900">Sound Notifications</div>
              <div className="text-sm text-slate-500">Play sound when new orders arrive</div>
            </div>
            <StatusToggle 
              isAvailable={settings.soundEnabled} 
              onToggle={() => setSettings({ ...settings, soundEnabled: !settings.soundEnabled })} 
            />
          </div>

          <div className="flex items-center justify-between pb-6 border-b border-slate-50">
            <div>
              <div className="font-medium text-slate-900">Toast Notifications</div>
              <div className="text-sm text-slate-500">Show popup alerts for new orders</div>
            </div>
            <StatusToggle 
              isAvailable={settings.notificationsEnabled} 
              onToggle={() => setSettings({ ...settings, notificationsEnabled: !settings.notificationsEnabled })} 
            />
          </div>

          {user.role === 'manager' && (
            <>
              <div className="flex items-center justify-between pb-6 border-b border-slate-50">
                <div>
                  <div className="font-medium text-slate-900">Store Status</div>
                  <div className="text-sm text-slate-500">Close the store to stop receiving new orders</div>
                </div>
                <StatusToggle 
                  isAvailable={settings.storeOpen} 
                  onToggle={() => setSettings({ ...settings, storeOpen: !settings.storeOpen })} 
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-900">Tax & Service</div>
                  <div className="text-sm text-slate-500">Applied to all orders automatically</div>
                </div>
                <div className="flex items-center gap-2">
                  <Input 
                    className="w-20 text-right" 
                    type="number"
                    value={settings.taxPercentage}
                    onChange={(e) => setSettings({ ...settings, taxPercentage: Number(e.target.value) })}
                  />
                  <span className="text-slate-500">%</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add User Modal */}
      {showAddUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold font-serif">Add New User</h3>
              <button onClick={() => setShowAddUser(false)}><X size={20} className="text-slate-400" /></button>
            </div>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Full Name</label>
                <Input value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} placeholder="e.g. John Doe" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Username</label>
                <Input value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} placeholder="e.g. johnd" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">PIN Code</label>
                <Input value={newUser.pin} onChange={e => setNewUser({...newUser, pin: e.target.value})} placeholder="4 digits" maxLength={4} />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Role</label>
                <select 
                  className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white text-sm"
                  value={newUser.role}
                  onChange={e => setNewUser({...newUser, role: e.target.value as Role})}
                >
                  <option value="staff">Staff</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div className="pt-4 flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowAddUser(false)}>Cancel</Button>
                <Button type="submit" className="flex-1 bg-orange-600 hover:bg-orange-700 text-white">Create User</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Main Layout Component ---

export default function HouseApp() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'orders' | 'reviews' | 'menu' | 'sales' | 'settings'>('menu');
  const [orders, setOrders] = useState<Order[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    soundEnabled: true,
    notificationsEnabled: true,
    taxPercentage: 21,
    storeOpen: true
  });

  // Use Custom Hooks
  useWakeLock();
  
  // Calculate pending orders
  const pendingOrdersCount = orders.filter(o => o.status === 'incoming').length;
  useDynamicTitle(pendingOrdersCount);

  // Listen to Authentication State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        // Map Firebase User to App User
        // Ideally fetch this from Firestore 'users' collection
        // For now, default to Manager
        setUser({
          id: firebaseUser.uid,
          username: firebaseUser.email || 'User',
          name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Admin',
          role: 'manager', // Default to manager for now
          pin: '****' 
        });
      } else {
        setUser(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Load Settings
  useEffect(() => {
    const saved = localStorage.getItem('houseAppSettings');
    if (saved) {
      setSettings(JSON.parse(saved));
    }
  }, []);

  // Save Settings
  useEffect(() => {
    localStorage.setItem('houseAppSettings', JSON.stringify(settings));
  }, [settings]);

  // Real-time Orders Listener
  useEffect(() => {
    let isFirstLoad = true;
    const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedOrders = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      })) as Order[];
      
      setOrders(fetchedOrders);

      // Notification Logic
      if (!isFirstLoad) {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            // Check if it's a recent order (within last 30s) to avoid old orders triggering sound on slight connectivity refresh
            const data = change.doc.data();
            if (data.createdAt) {
               // Play Sound
               if (settings.soundEnabled) {
                 const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
                 audio.play().catch(e => console.log('Audio play failed', e));
               }
               // Show Toast
               if (settings.notificationsEnabled) {
                 toast.success(`New Order from Room ${data.roomNumber}!`);
               }
            }
          }
        });
      }
      isFirstLoad = false;
    });

    return () => unsubscribe();
  }, [settings.soundEnabled, settings.notificationsEnabled]);

  if (!user) {
    return <LoginScreen />;
  }

  const incomingCount = orders.filter(o => o.status === 'incoming').length;

  const navItems = [
    { id: 'orders', label: 'Live Orders', icon: Bell, badge: incomingCount > 0 ? incomingCount : undefined },
    { id: 'reviews', label: 'Reviews', icon: Star },
    { id: 'menu', label: 'Menu Manager', icon: Utensils },
    { id: 'sales', label: 'Sales Report', icon: BarChart },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // user state is cleared by onAuthStateChanged
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      <Toaster />
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-100 flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10">
        <div className="p-8 pb-4">
          <div className="flex items-center gap-3 mb-8">
            <img 
              src="https://i.ibb.co.com/c5fhDh6/The-Gallery-Restaurant.png" 
              alt="Ciputra Logo" 
              className="w-auto h-16 object-contain"
            />
            </div>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group relative ${
                  isActive 
                    ? 'bg-orange-50 text-orange-700 font-medium shadow-xs' 
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute left-0 top-0 bottom-0 w-1 bg-orange-600 rounded-r-full"
                  />
                )}
                <div className="flex items-center gap-3">
                  <Icon size={20} className={isActive ? 'text-orange-600' : 'text-slate-400 group-hover:text-slate-600'} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 mt-auto">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
          >
            <LogOut size={20} />
            <span>Log Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="h-20 bg-white border-b border-slate-100 flex items-center justify-between px-8 shrink-0">
          <h2 className="text-xl font-serif font-bold text-slate-800">
            {navItems.find(i => i.id === activeTab)?.label}
          </h2>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end mr-2">
              <span className="text-sm font-bold text-slate-900">{user.name}</span>
              <span className="text-xs text-slate-500 capitalize">{user.role}</span>
            </div>
            <div className="h-10 w-10 rounded-full bg-slate-100 border-2 border-white shadow-sm overflow-hidden flex items-center justify-center text-slate-400">
              {user.username ? (
                <span className="font-bold text-lg text-slate-600">{user.username[0].toUpperCase()}</span>
              ) : (
                <Users size={20} />
              )}
            </div>
          </div>
        </header>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto bg-slate-50 p-8">
          <div className="max-w-7xl mx-auto h-full">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="h-full"
              >
                {activeTab === 'menu' && <MenuManager />}
                {activeTab === 'orders' && <LiveOrders orders={orders} />}
                {activeTab === 'reviews' && <ReviewsView orders={orders} />}
                {activeTab === 'sales' && <SalesReport user={user} orders={orders} />}
                {activeTab === 'settings' && <SettingsView user={user} settings={settings} setSettings={setSettings} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
