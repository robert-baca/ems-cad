import { registerPlugin } from '@capacitor/core';

export const PROD_URL = 'https://cad.sfotems.com';
export const isNative = () => !!(window.Capacitor?.isNativePlatform?.());
export const apiBase  = () => isNative() ? `${PROD_URL}/api` : '/api';
export const sockUrl  = () => isNative() ? PROD_URL : '';

// Used only for the "open location settings" deep link — unrelated to which
// plugin actually tracks location on either platform (see GpsTracker in
// useCrewGps.js for that). Cached module-level so repeated calls (e.g. from
// both useCrewGps.js and NativeSetupModal.jsx) share one registered instance.
let _bgGeo = null;
export function getBackgroundGeolocation() {
  if (!_bgGeo) _bgGeo = registerPlugin('BackgroundGeolocation');
  return _bgGeo;
}

// Bypasses @capacitor/core's registerPlugin() proxy, which gates every call
// on window.Capacitor.PluginHeaders having an entry for the plugin. Confirmed
// via a live device diagnostic that PluginHeaders never gets an entry for a
// locally-registered plugin (registerPluginInstance()) on iOS -- see
// GpsTracker's use of this same pattern in useCrewGps.js for the full story.
// nativePromise() is the same low-level dispatch the proxy uses internally,
// just without the broken PluginHeaders check gating it, so it works
// regardless of whether a given plugin's JS proxy got wired up correctly.
// Used here for npm-registered plugins too (Geolocation, LocalNotifications)
// since there's no confirmed guarantee their proxy survives every page/origin
// this app's WebView navigates to either.
export function nativeCall(plugin, method, options = {}) {
  return window.Capacitor.nativePromise(plugin, method, options);
}

// Same reasoning as nativeCall above, but for persistent event listeners
// (addListener-style APIs, e.g. PushNotifications' 'registration' event)
// rather than one-shot calls -- registerPlugin()'s proxy builds its own
// addListener() on top of this same low-level nativeCallback dispatch, gated
// behind the same broken PluginHeaders check. Returns a Capacitor
// CallbackID (string) that can be passed to window.Capacitor.removeListener
// to unsubscribe, mirroring what the standard proxy's addListener() would
// have returned.
export function nativeListener(plugin, eventName, callback) {
  return window.Capacitor.nativeCallback(plugin, 'addListener', { eventName }, callback);
}
