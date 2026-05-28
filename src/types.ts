import React from 'react';

export type ViewState = 'login' | 'menu' | 'checkout' | 'tracking';
export type Language = 'EN' | 'ID';

export interface CartItem extends MenuItem {
  qty: number;
  note: string;
}

export interface MenuItem {
  id: number;
  name: string;
  desc: string;
  price: number;
  image: string;
  category: string;
  popular?: boolean;
}
