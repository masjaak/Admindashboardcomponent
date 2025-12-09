import { useEffect, useRef, useState } from 'react';

// Perhatikan ada kata 'export' langsung di depan 'const'
export const useWakeLock = () => {
  const wakeLock = useRef(null);
  const [status, setStatus] = useState('inactive');

  useEffect(() => {
    // Cek support browser
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      console.warn('⚠️ HCS: Wake Lock API not supported.');
      return;
    }

    const requestWakeLock = async () => {
      try {
        wakeLock.current = await navigator.wakeLock.request('screen');
        setStatus('active');
        console.log('✅ HCS: Screen Wake Lock ACTIVE');
      } catch (err) {
        // Error handling aman untuk Figma/Iframe
        if (err.name === 'NotAllowedError') {
          console.warn('⚠️ HCS WakeLock: Izin ditolak (Cek tab baru).');
        } else {
          console.error(`❌ HCS WakeLock Error: ${err.name}, ${err.message}`);
        }
        setStatus('error');
      }
    };

    requestWakeLock();

    const handleVisibilityChange = async () => {
      if (wakeLock.current !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (wakeLock.current) {
        wakeLock.current.release();
        wakeLock.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return status;
};

// JANGAN ADA export default DI BAWAH SINI