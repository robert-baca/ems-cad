import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { nativeCall, getBackgroundGeolocation } from '../../lib/native';

const ALL_STEPS = [
  {
    key: 'location',
    icon: '📍',
    title: 'Location — Always',
    body: "Required so your GPS dot shows on the dispatch map even when the screen is off. You'll see two popups — the first won't have an \"Always\" option, that's normal. A second popup follows right after asking to upgrade — choose \"Always\" (or \"Change to Always Allow\") on that one.",
    button: 'Grant Location',
  },
  {
    key: 'notifications',
    icon: '🔔',
    title: 'Notifications',
    body: 'Required so your phone alerts you with sound and vibration when dispatch assigns you a call.',
    button: 'Allow Notifications',
  },
  {
    key: 'battery',
    icon: '🔋',
    title: 'Unrestricted Battery',
    body: 'Go to Settings → Apps → this app → Battery → set to Unrestricted. This prevents Android from killing GPS.',
    button: 'Got it',
    androidOnly: true,
  },
  // Neither of these can be set by the app itself -- Android only lets the
  // user grant a channel's DND override, and watch mirroring lives in the
  // watch's own companion app -- so like battery, instructions only.
  {
    key: 'dnd',
    icon: '🚨',
    title: 'Alerts Through Do Not Disturb',
    body: 'Settings → Apps → EMS Crew → Notifications → EMS Call Alerts → turn on "Override Do Not Disturb". (Samsung: Settings → Notifications → Do not disturb → App notifications → add EMS Crew.) Calls, dispatch pings and broadcasts will still come through on silent.',
    button: 'Got it',
    androidOnly: true,
    since: 2,
  },
  {
    key: 'dnd',
    icon: '🚨',
    title: 'Alerts Through Focus',
    body: 'If iPhone asks whether EMS Crew can send Time Sensitive notifications, tap Allow. If you use Focus / Do Not Disturb: Settings → Focus → each mode → Apps → turn on "Time Sensitive Notifications". Calls, dispatch pings and broadcasts will then still come through.',
    button: 'Got it',
    iosOnly: true,
    since: 2,
  },
  {
    key: 'watch',
    icon: '⌚',
    title: 'Smartwatch Alerts',
    body: 'Wear a watch? Apple Watch: Watch app on your iPhone → Notifications → EMS Crew → Mirror my iPhone. Galaxy Watch: Galaxy Wearable app → Watch settings → Notifications → turn on EMS Crew. Pixel Watch: Pixel Watch app → Notifications → EMS Crew on. No watch? Just tap Got it.',
    button: 'Got it',
    since: 2,
  },
];

// Bump when adding steps (and tag them `since` the new version): phones that
// finished an older setup see just the steps added since, once. Stored in
// native_setup_done -- the original setup saved '1' there.
export const SETUP_VERSION = 2;
export const setupDoneVersion = () => parseInt(localStorage.getItem('native_setup_done') || '0', 10) || 0;

// Platform-specific steps (e.g. no "Unrestricted Battery" setting on iOS)
// would just be confusing on the other platform.
const platform = Capacitor.getPlatform();
const PLATFORM_STEPS = ALL_STEPS.filter(s =>
  !(s.androidOnly && platform !== 'android') && !(s.iosOnly && platform !== 'ios'));

export default function NativeSetupModal({ onDone }) {
  const [doneBefore] = useState(setupDoneVersion);
  const STEPS = PLATFORM_STEPS.filter(s => (s.since || 1) > doneBefore);
  const [step, setStep]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  // Set when a permission request comes back denied — the step's button turns into
  // an explicit "continue anyway" so a denial is never silently skipped past.
  const [permWarning, setPermWarning] = useState('');
  const [awaitingAck, setAwaitingAck] = useState(false);

  const current = STEPS[step];

  const advance = () => {
    setPermWarning('');
    setAwaitingAck(false);
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      setDone(true);
      localStorage.setItem('native_setup_done', String(SETUP_VERSION));
      onDone();
    }
  };

  const handleStep = async () => {
    if (awaitingAck) { advance(); return; }
    setLoading(true);
    setPermWarning('');
    try {
      if (current.key === 'location') {
        const status = await nativeCall('Geolocation', 'requestPermissions', { permissions: ['location'] });
        if (status.location !== 'granted') {
          setLoading(false);
          setPermWarning("Location wasn't granted — GPS tracking won't work until you allow it. You can retry, or continue and fix it later from the GPS banner.");
          setAwaitingAck(true);
          return;
        }
        // iOS only ever grants "While Using" from the request above — Apple requires
        // a separate follow-up request to offer the "Always" upgrade. Ask for it here,
        // in the same flow, right while the crew member is paying attention, instead
        // of leaving it to whenever GPS tracking happens to start on its own later.
        if (Capacitor.getPlatform() === 'ios') {
          try {
            const bgGeo = getBackgroundGeolocation();
            // backgroundMessage is what tells the native plugin to request
            // "Always" rather than "When In Use" (see ios/Plugin/Swift/Plugin.swift) —
            // without it this silently re-requests While-Using and does nothing.
            const watcherId = await bgGeo.addWatcher({
              requestPermissions: true,
              stale: true,
              backgroundMessage: 'EMS Crew GPS is active.',
              backgroundTitle: 'EMS Crew Tracking',
            }, () => {});
            await bgGeo.removeWatcher({ id: watcherId });
          } catch {
            // Not fatal — declining the upgrade just leaves it at "While Using";
            // the GPS banner catches that later and offers a Settings shortcut.
          }
        }
      } else if (current.key === 'notifications') {
        const status = await nativeCall('LocalNotifications', 'requestPermissions');
        if (status.display !== 'granted') {
          setLoading(false);
          setPermWarning("Notifications weren't granted — you won't get alert sounds for new calls. You can retry, or continue and fix it later.");
          setAwaitingAck(true);
          return;
        }
        // Create the channel immediately after permission is granted so it exists
        // with IMPORTANCE_MAX before any call notification is ever scheduled.
        const { createNotifChannel } = await import('../../hooks/useCrewNotifications');
        await createNotifChannel();
      }
      // battery step: instructions only, no plugin needed
    } catch {
      setLoading(false);
      setPermWarning('Something went wrong requesting this permission — you can grant it later from Settings.');
      setAwaitingAck(true);
      return;
    }
    setLoading(false);
    advance();
  };

  if (done) return null;

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🚑</div>
          <div className="text-white font-bold text-xl">{doneBefore ? 'New Setup Steps' : 'One-Time Setup'}</div>
          <div className="text-gray-400 text-sm mt-1">
            {doneBefore
              ? `${STEPS.length} quick settings so call alerts always reach you`
              : `Allow these ${STEPS.length} things so GPS tracking and call alerts work`}
          </div>
        </div>

        <div className="flex justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.key} className={`w-2 h-2 rounded-full transition-colors ${
              i < step ? 'bg-green-500' : i === step ? 'bg-blue-400' : 'bg-gray-600'
            }`} />
          ))}
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 mb-6 text-center">
          <div className="text-4xl mb-3">{current.icon}</div>
          <div className="text-white font-bold text-lg mb-2">{current.title}</div>
          <div className="text-gray-400 text-sm leading-relaxed">{current.body}</div>
        </div>

        <div className="text-gray-500 text-xs text-center mb-4">
          Step {step + 1} of {STEPS.length}
        </div>

        {permWarning && (
          <div className="text-amber-400 text-xs text-center bg-amber-900/30 border border-amber-700/50 rounded-xl px-4 py-2 mb-4">
            {permWarning}
          </div>
        )}

        <button
          onClick={handleStep}
          disabled={loading}
          className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white font-bold text-base rounded-2xl transition-colors"
        >
          {loading ? 'Opening…' : awaitingAck ? 'Continue Anyway →' : current.button}
        </button>

        {step === STEPS.length - 1 && (
          <button
            onClick={() => { localStorage.setItem('native_setup_done', String(SETUP_VERSION)); onDone(); }}
            className="w-full mt-3 py-2.5 text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            Skip — I'll set it up later
          </button>
        )}
      </div>
    </div>
  );
}
