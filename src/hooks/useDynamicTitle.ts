import { useEffect } from 'react';

export const useDynamicTitle = (pendingCount: number) => {
  useEffect(() => {
    if (pendingCount > 0) {
      document.title = `(${pendingCount}) 🔔 ORDER MASUK`;
    } else {
      document.title = 'Standby - Admin Dashboard';
    }
  }, [pendingCount]);
};
