import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, ShoppingBag, Plus, Minus, X } from "lucide-react";
import { Language, MenuItem, CartItem } from "../types";

// Mock Data for Menu
const MENU_ITEMS: MenuItem[] = [
  { id: 1, name: "Nasi Goreng Ciputra", desc: "Fried rice with satay, fried chicken & egg", price: 85000, category: "Main Course", image: "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&q=80&w=300", popular: true },
  { id: 2, name: "Sate Ayam Madura", desc: "Grilled chicken skewers with peanut sauce", price: 75000, category: "Main Course", image: "https://images.unsplash.com/photo-1529563021893-cc83c914d72d?auto=format&fit=crop&q=80&w=300", popular: true },
  { id: 3, name: "Iced Lemon Tea", desc: "Fresh brewed tea with lemon slice", price: 35000, category: "Beverage", image: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&q=80&w=300" },
  { id: 4, name: "Caesar Salad", desc: "Romaine lettuce, croutons, parmesan cheese", price: 65000, category: "Appetizer", image: "https://images.unsplash.com/photo-1546793665-c74683f339c1?auto=format&fit=crop&q=80&w=300" },
  { id: 5, name: "Beef Burger", desc: "Juicy beef patty with cheese and fries", price: 95000, category: "Western", image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&q=80&w=300", popular: true },
  { id: 6, name: "Mineral Water", desc: "600ml bottled water", price: 25000, category: "Beverage", image: "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?auto=format&fit=crop&q=80&w=300" },
];

const CATEGORIES = ["All", "Main Course", "Appetizer", "Western", "Beverage"];

interface MenuViewProps {
  roomNumber: string;
  cart: CartItem[];
  addToCart: (item: MenuItem, qty: number, note: string) => void;
  removeFromCart: (index: number) => void;
  onCheckout: () => void;
  lang: Language;
}

export const MenuView: React.FC<MenuViewProps> = ({ 
  roomNumber, 
  cart, 
  addToCart, 
  onCheckout, 
  lang 
}) => {
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  
  // Modal State
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const filteredMenu = MENU_ITEMS.filter(item => {
    const matchesCategory = activeCategory === "All" || item.category === activeCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const cartTotalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  const cartTotalPrice = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

  const openModal = (item: MenuItem) => {
    setSelectedItem(item);
    setQty(1);
    setNote("");
  };

  const handleAddToCart = () => {
    if (selectedItem) {
      addToCart(selectedItem, qty, note);
      setSelectedItem(null);
    }
  };

  return (
    <div className="pb-24 min-h-screen bg-slate-50 relative">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white shadow-sm pb-2">
        <div className="px-6 py-4 flex justify-between items-center">
          <div>
            <div className="text-xs font-bold text-orange-600 uppercase tracking-wider">Room Service</div>
            <div className="font-serif font-bold text-xl text-slate-800">Room {roomNumber}</div>
          </div>
          <div className="h-10 w-10 bg-slate-100 rounded-full flex items-center justify-center">
            <span className="font-serif font-bold text-slate-600">C</span>
          </div>
        </div>

        {/* Search */}
        <div className="px-6 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder={lang === 'EN' ? "Search menu..." : "Cari menu..."}
              className="w-full pl-10 pr-4 py-3 bg-slate-50 rounded-xl text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-orange-100"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Categories */}
        <div className="overflow-x-auto px-6 pb-2 no-scrollbar flex gap-3">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all ${
                activeCategory === cat 
                  ? 'bg-slate-900 text-white shadow-md' 
                  : 'bg-white border border-slate-200 text-slate-500'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Menu Grid */}
      <div className="p-6 grid grid-cols-1 gap-6">
        {filteredMenu.map(item => (
          <motion.div 
            layoutId={`item-${item.id}`}
            key={item.id}
            onClick={() => openModal(item)}
            className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex gap-4 cursor-pointer active:scale-[0.98] transition-transform"
          >
            <img src={item.image} alt={item.name} className="h-24 w-24 rounded-xl object-cover bg-slate-200" />
            <div className="flex-1 flex flex-col justify-center">
              {item.popular && (
                <span className="text-[10px] font-bold text-orange-600 bg-orange-50 w-fit px-2 py-0.5 rounded-full mb-1">
                  POPULAR
                </span>
              )}
              <h3 className="font-serif font-bold text-slate-800 leading-tight mb-1">{item.name}</h3>
              <p className="text-xs text-slate-400 line-clamp-2 mb-2 leading-relaxed">{item.desc}</p>
              <div className="font-bold text-slate-900">
                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(item.price)}
              </div>
            </div>
            <div className="self-end mb-1">
              <div className="h-8 w-8 bg-slate-900 rounded-full flex items-center justify-center text-white">
                <Plus size={16} />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Floating Cart Button */}
      <AnimatePresence>
        {cartTotalQty > 0 && (
          <motion.div 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-6 left-6 right-6 z-20"
          >
            <button 
              onClick={onCheckout}
              className="w-full bg-slate-900 text-white p-4 rounded-2xl shadow-xl shadow-slate-300 flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 bg-orange-500 rounded-full flex items-center justify-center text-xs font-bold">
                  {cartTotalQty}
                </div>
                <div className="text-left">
                  <div className="text-xs text-slate-400 font-medium">Total</div>
                  <div className="font-bold">
                    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(cartTotalPrice)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 font-bold text-sm pr-2">
                {lang === 'EN' ? 'Checkout' : 'Bayar'}
                <ShoppingBag size={18} />
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Item Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-none">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItem(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-xs pointer-events-auto"
            />
            
            {/* Modal Content */}
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 pb-8 pointer-events-auto relative max-h-[90vh] overflow-y-auto"
            >
              <button 
                onClick={() => setSelectedItem(null)}
                className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full text-slate-500"
              >
                <X size={20} />
              </button>

              <div className="flex gap-4 mb-6">
                <img 
                  src={selectedItem.image} 
                  alt={selectedItem.name} 
                  className="h-24 w-24 rounded-2xl object-cover"
                />
                <div>
                  <h3 className="font-serif font-bold text-xl text-slate-900 mb-1">{selectedItem.name}</h3>
                  <div className="font-bold text-orange-600 text-lg">
                    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(selectedItem.price)}
                  </div>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  {lang === 'EN' ? 'Special Request (Optional)' : 'Catatan Khusus (Opsional)'}
                </label>
                <textarea 
                  className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-100"
                  rows={3}
                  placeholder={lang === 'EN' ? 'e.g. No spicy, extra sauce...' : 'cth. Jangan pedas, saus dipisah...'}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 bg-slate-50 p-2 rounded-xl border border-slate-200">
                  <button 
                    onClick={() => setQty(Math.max(1, qty - 1))}
                    className="h-10 w-10 bg-white rounded-lg flex items-center justify-center shadow-xs disabled:opacity-50"
                    disabled={qty <= 1}
                  >
                    <Minus size={18} />
                  </button>
                  <span className="font-bold text-lg w-4 text-center">{qty}</span>
                  <button 
                    onClick={() => setQty(qty + 1)}
                    className="h-10 w-10 bg-white rounded-lg flex items-center justify-center shadow-xs"
                  >
                    <Plus size={18} />
                  </button>
                </div>

                <button 
                  onClick={handleAddToCart}
                  className="flex-1 bg-slate-900 text-white h-14 rounded-xl font-bold text-sm shadow-lg shadow-slate-200 active:scale-95 transition-transform"
                >
                  {lang === 'EN' ? `Add - ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(selectedItem.price * qty)}` : `Tambah - ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(selectedItem.price * qty)}`}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
