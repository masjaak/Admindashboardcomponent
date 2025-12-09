import React, { useState } from "react";
import { motion } from "motion/react";
import { Language } from "../types";

interface LoginViewProps {
  lang: Language;
  setLang: (lang: Language) => void;
  onLogin: (room: string, phone: string) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ lang, setLang, onLogin }) => {
  const [roomNumber, setRoomNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomNumber || !phoneNumber) {
      setError(lang === 'EN' ? 'Please fill in all fields' : 'Mohon isi semua kolom');
      return;
    }
    onLogin(roomNumber, phoneNumber);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50"
    >
      <div className="w-full max-w-sm bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
        <div className="text-center mb-8">
          <div className="mx-auto h-20 w-20 bg-orange-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-orange-200">
            <span className="text-3xl font-bold text-white font-serif">C</span>
          </div>
          <h1 className="text-2xl font-serif font-bold text-slate-800 mb-1">
            {lang === 'EN' ? 'Welcome Guest' : 'Selamat Datang'}
          </h1>
          <p className="text-slate-500 text-sm">Hotel Ciputra Semarang</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5 ml-1">
              {lang === 'EN' ? 'Room Number' : 'Nomor Kamar'}
            </label>
            <input
              type="number"
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all font-medium text-slate-800 placeholder:text-slate-400"
              placeholder="e.g. 101"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5 ml-1">
              {lang === 'EN' ? 'Phone / WhatsApp' : 'No. HP / WhatsApp'}
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all font-medium text-slate-800 placeholder:text-slate-400"
              placeholder="e.g. 08123456789"
            />
          </div>

          {error && (
            <div className="text-red-500 text-sm text-center bg-red-50 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl shadow-lg shadow-slate-200 hover:bg-slate-800 active:scale-[0.98] transition-all"
          >
            {lang === 'EN' ? 'Enter Menu' : 'Masuk Menu'}
          </button>
        </form>

        <div className="mt-8 flex justify-center gap-3">
          <button 
            onClick={() => setLang('EN')}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${lang === 'EN' ? 'bg-orange-100 text-orange-700' : 'text-slate-400 hover:bg-slate-100'}`}
          >
            English
          </button>
          <button 
            onClick={() => setLang('ID')}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${lang === 'ID' ? 'bg-orange-100 text-orange-700' : 'text-slate-400 hover:bg-slate-100'}`}
          >
            Indonesia
          </button>
        </div>
      </div>
    </motion.div>
  );
};
