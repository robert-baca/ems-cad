import { LocalNotifications } from '@capacitor/local-notifications';

export const NOTIF_CHANNEL_ID = 'ems-cad-headsup-v2';
let _notifId = 100;

// Called from NativeSetupModal right after permission is granted,
// so the channel exists with correct settings before any call fires.
export async function createNotifChannel() {
  try {
    await LocalNotifications.createChannel({
      id:         NOTIF_CHANNEL_ID,
      name:       'EMS Call Alerts',
      importance:  5,    // IMPORTANCE_MAX → heads-up banner + sound + vibration
      vibration:   true,
      lights:      true,
      lightColor:  '#FF0000',
    });
  } catch (e) {
    console.warn('[notifications] createChannel failed', e);
  }
}

export async function scheduleNotif(title, body) {
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id:         _notifId++,
        title,
        body,
        channelId:  NOTIF_CHANNEL_ID, // Android channel
        sound:      'default',         // iOS sound (Android uses channel setting)
        smallIcon:  'ic_launcher',
        iconColor:  '#FF0000',
        autoCancel: true,
      }],
    });
  } catch (e) {
    console.warn('[notifications] schedule failed', e);
  }
}

// Hook is now a thin wrapper — permission and channel are handled in NativeSetupModal.
export function useCrewNotifications() {
  return { scheduleNotif };
}
