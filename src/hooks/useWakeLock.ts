import { useEffect, useRef, useState } from 'react';

export const useWakeLock = () => {
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const [status, setStatus] = useState('inactive');

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      console.warn('Wake Lock API not supported.');
      return;
    }

    const requestWakeLock = async () => {
      try {
        wakeLock.current = await navigator.wakeLock.request('screen');
        setStatus('active');
        console.log('Screen Wake Lock ACTIVE');
      } catch (err) {
        if ((err as { name?: string }).name === 'NotAllowedError') {
          console.warn('WakeLock: Permission denied.');
        } else {
          console.error(`WakeLock Error: ${(err as Error).name}, ${(err as Error).message}`);
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