import React, { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Trash2, CreditCard, Banknote, QrCode } from "lucide-react";
import { Language, CartItem } from "../types";

interface CheckoutViewProps {
  cart: CartItem[];
  onBack: () => void;
  onPlaceOrder: (method: string, proof: File | null) => void;
  loading: boolean;
  phoneNumber: string;
  lang: Language;
}

export const CheckoutView: React.FC<CheckoutViewProps> = ({ 
  cart, 
  onBack, 
  onPlaceOrder, 
  loading, 
  phoneNumber, 
  lang 
}) => {
  const [paymentMethod, setPaymentMethod] = useState("room"); // room, qris, bank
  const [proof, setProof] = useState<File | null>(null);

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const tax = subtotal * 0.21;
  const total = subtotal + tax;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setProof(e.target.files[0]);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="min-h-screen bg-slate-50 flex flex-col"
    >
      {/* Header */}
      <div className="bg-white px-6 py-4 flex items-center gap-4 shadow-sm sticky top-0 z-10">
        <button onClick={onBack} className="p-2 -ml-2 hover:bg-slate-50 rounded-full transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-serif font-bold text-xl text-slate-800">
          {lang === 'EN' ? 'Order Summary' : 'Ringkasan Pesanan'}
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6 pb-32">
        {/* Order Items */}
        <div className="space-y-4 mb-8">
          {cart.map((item, idx) => (
            <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-100 flex gap-4">
              <div className="h-16 w-16 bg-slate-100 rounded-xl flex items-center justify-center font-bold text-slate-500">
                {item.qty}x
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-slate-800">{item.name}</h3>
                <div className="text-sm text-slate-500 mb-1">
                  {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(item.price)}
                </div>
                {item.note && (
                  <div className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded-md inline-block">
                    "{item.note}"
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Bill Details */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 mb-8 space-y-3">
          <div className="flex justify-between text-sm text-slate-500">
            <span>Subtotal</span>
            <span>{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-500">
            <span>Service & Tax (21%)</span>
            <span>{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(tax)}</span>
          </div>
          <div className="border-t border-dashed border-slate-200 my-2 pt-2 flex justify-between font-bold text-lg text-slate-900">
            <span>Total</span>
            <span>{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(total)}</span>
          </div>
        </div>

        {/* Payment Method */}
        <h3 className="font-bold text-slate-800 mb-3 ml-1">
          {lang === 'EN' ? 'Payment Method' : 'Metode Pembayaran'}
        </h3>
        <div className="grid grid-cols-1 gap-3 mb-8">
          <button 
            onClick={() => setPaymentMethod('room')}
            className={`p-4 rounded-xl border flex items-center gap-3 transition-all ${paymentMethod === 'room' ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500' : 'border-slate-200 bg-white'}`}
          >
            <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
              <Banknote size={20} />
            </div>
            <div className="text-left">
              <div className="font-bold text-slate-800">Charge to Room</div>
              <div className="text-xs text-slate-500">Pay upon checkout</div>
            </div>
          </button>

          <button 
            onClick={() => setPaymentMethod('qris')}
            className={`p-4 rounded-xl border flex items-center gap-3 transition-all ${paymentMethod === 'qris' ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500' : 'border-slate-200 bg-white'}`}
          >
            <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
              <QrCode size={20} />
            </div>
            <div className="text-left">
              <div className="font-bold text-slate-800">QRIS / E-Wallet</div>
              <div className="text-xs text-slate-500">Scan QR code</div>
            </div>
          </button>

          <button 
            onClick={() => setPaymentMethod('bank')}
            className={`p-4 rounded-xl border flex items-center gap-3 transition-all ${paymentMethod === 'bank' ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500' : 'border-slate-200 bg-white'}`}
          >
            <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
              <CreditCard size={20} />
            </div>
            <div className="text-left">
              <div className="font-bold text-slate-800">Bank Transfer</div>
              <div className="text-xs text-slate-500">Manual transfer</div>
            </div>
          </button>
        </div>

        {/* Payment Proof Upload (Only for non-room payment) */}
        {paymentMethod !== 'room' && (
          <div className="mb-8">
            <h3 className="font-bold text-slate-800 mb-3 ml-1">
              {lang === 'EN' ? 'Payment Proof' : 'Bukti Pembayaran'}
            </h3>
            <div className="bg-white p-6 rounded-2xl border border-dashed border-slate-300 text-center">
              <input 
                type="file" 
                accept="image/*"
                onChange={handleFileChange}
                className="hidden" 
                id="proof-upload" 
              />
              <label htmlFor="proof-upload" className="cursor-pointer block">
                {proof ? (
                  <div className="text-green-600 font-medium flex items-center justify-center gap-2">
                    <CheckCircle size={18} />
                    {proof.name}
                  </div>
                ) : (
                  <div className="text-slate-500 text-sm">
                    <span className="text-orange-600 font-bold">Click to upload</span> image
                  </div>
                )}
              </label>
            </div>
            {/* Mock QR or Bank Info would go here */}
            <div className="mt-2 text-xs text-center text-slate-400">
              {paymentMethod === 'qris' ? 'Scan QRIS code provided in room' : 'BCA 123-456-7890 a.n Hotel Ciputra'}
            </div>
          </div>
        )}
      </div>

      {/* Footer Action */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white border-t border-slate-100 z-20">
        <button 
          onClick={() => onPlaceOrder(paymentMethod, proof)}
          disabled={loading || (paymentMethod !== 'room' && !proof)}
          className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl shadow-lg shadow-slate-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            'Processing...'
          ) : (
            <>
              {lang === 'EN' ? 'Confirm Order' : 'Konfirmasi Pesanan'} 
              <span className="bg-slate-800 px-2 py-0.5 rounded text-xs">
                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(total)}
              </span>
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
};

// Helper Icon
const CheckCircle = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
);
