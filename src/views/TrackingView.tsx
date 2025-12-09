import React from "react";
import { motion } from "motion/react";
import { CheckCircle, ArrowRight } from "lucide-react";
import { Language } from "../types";

interface TrackingViewProps {
  roomNumber: string;
  onFinish: () => void;
  lang: Language;
}

export const TrackingView: React.FC<TrackingViewProps> = ({ roomNumber, onFinish, lang }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-center"
    >
      <div className="h-24 w-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
        <CheckCircle size={48} />
      </div>

      <h1 className="text-2xl font-serif font-bold text-slate-800 mb-2">
        {lang === 'EN' ? 'Order Received!' : 'Pesanan Diterima!'}
      </h1>
      <p className="text-slate-500 mb-8 max-w-xs mx-auto">
        {lang === 'EN' 
          ? `Thank you, Room ${roomNumber}. We have sent your order details to the kitchen via WhatsApp.`
          : `Terima kasih, Kamar ${roomNumber}. Kami telah mengirim detail pesanan Anda ke dapur via WhatsApp.`}
      </p>

      <div className="bg-white p-6 rounded-2xl border border-slate-100 w-full max-w-sm mb-8">
        <div className="flex items-center gap-4 mb-4">
          <div className="h-10 w-10 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 font-bold">1</div>
          <div className="text-left flex-1">
            <div className="font-bold text-slate-800">{lang === 'EN' ? 'Order Confirmation' : 'Konfirmasi Pesanan'}</div>
            <div className="text-xs text-slate-400">WhatsApp sent to Staff</div>
          </div>
          <CheckCircle size={16} className="text-green-500" />
        </div>
        <div className="flex items-center gap-4 mb-4">
          <div className="h-10 w-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 font-bold border border-slate-200">2</div>
          <div className="text-left flex-1">
            <div className="font-bold text-slate-400">{lang === 'EN' ? 'Kitchen Preparation' : 'Persiapan Dapur'}</div>
            <div className="text-xs text-slate-400">~ 15-20 Mins</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 font-bold border border-slate-200">3</div>
          <div className="text-left flex-1">
            <div className="font-bold text-slate-400">{lang === 'EN' ? 'Delivery to Room' : 'Pengantaran ke Kamar'}</div>
            <div className="text-xs text-slate-400">Wait in room</div>
          </div>
        </div>
      </div>

      <button 
        onClick={onFinish}
        className="text-slate-400 hover:text-slate-600 font-medium flex items-center gap-2 transition-colors"
      >
        {lang === 'EN' ? 'Back to Home' : 'Kembali ke Beranda'} <ArrowRight size={16} />
      </button>
    </motion.div>
  );
};
