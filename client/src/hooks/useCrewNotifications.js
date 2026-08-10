import { useEffect } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';

let _notifId = 100;

async function scheduleNotif(title, body) {
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id:          _notifId++,
        title,
        body,
        importance:  5,
        smallIcon:   'ic_launcher',
        iconColor:   '#EF4444',
        sound:       null,
      }],
    });
  } catch (e) {
    console.warn('[notifications]', e);
  }
}

export function useCrewNotifications() {
  useEffect(() => {
    LocalNotifications.requestPermissions().catch(() => {});
  }, []);

  return { scheduleNotif };
}
