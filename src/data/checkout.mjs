import settings from '../../config/payment-links.json';
import definitions from '../../config/products.json';
import store from '../../config/store.json';
import { checkoutMode, validatePaymentLinks } from './payment-links.mjs';

export const mode = checkoutMode(process.env.CHECKOUT_MODE || 'payment_links');
export const usesCart = mode === 'api';
export const paymentLinks = settings;
export const products = usesCart
  ? definitions
  : validatePaymentLinks(settings, definitions, store);
