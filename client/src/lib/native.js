export const PROD_URL = 'https://cad.sfotems.com';
export const isNative = () => !!(window.Capacitor?.isNativePlatform?.());
export const apiBase  = () => isNative() ? `${PROD_URL}/api` : '/api';
export const sockUrl  = () => isNative() ? PROD_URL : '';
