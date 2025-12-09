import { useEffect } from 'react';

export const useDynamicTitle = (pendingCount: number) => {
  useEffect(() => {
    if (pendingCount > 0) {
      document.title = `(${pendingCount}) 🔔 ORDER MASUK - HCS`;
    } else {
      document.title = 'Standby - HCS House App';
    }
  }, [pendingCount]);
};
