import { useState } from 'react';
import { PLATFORM_STEPS } from './NativeSetupModal';
import { isNative } from '../../lib/native';

// Reference copy of the first-time setup (location, notifications, battery,
// watch) plus a few "if something's not working" tips, reachable any time
// from the ? button in the crew header. The setup text comes straight from
// NativeSetupModal's step list, so the two never disagree.

// Where each setup step is fixed after the fact. The app's own settings page
// has Location, Notifications and (Android) Battery on it.
const SETTINGS_STEPS = new Set(['location', 'notifications', 'battery']);

const TIPS = [
  {
    icon: '📍',
    title: 'GPS says "stale" or my dot isn\'t moving',
    body: 'Open this app and leave it open for a minute. If you\'re indoors, step outside briefly. Check that Location is set to "Always" (tap Open Settings under Location above). On Android, also check Battery is Unrestricted.',
  },
  {
    icon: '🔕',
    title: 'I\'m not getting call alerts',
    body: 'Check the notification line under your status at the top of the main screen. If it says off or not working, tap Open Settings under Notifications above and turn them on. Dispatch can send a test notification to your phone to confirm it works.',
  },
  {
    icon: '⌚',
    title: 'My watch doesn\'t buzz',
    body: 'Your watch shows whatever your phone shows. First make sure the phone itself alerts, then redo the watch step above. Alerts won\'t reach a watch that\'s out of Bluetooth range of the phone.',
  },
  {
    icon: '🚨',
    title: 'Emergency button',
    body: 'Hold the red EMERGENCY bar for 2 seconds, on a call or not. Dispatch gets a siren and the nearest crews are alerted with a compass to you. Your location is shared until it\'s resolved. If it says NOT SENT, you have no signal — use your radio. Hold "I\'m OK" to cancel.',
  },
  {
    icon: '📡',
    title: 'No signal',
    body: 'Status taps and messages you send without signal are saved and sent automatically when you reconnect — the banner at the top shows how many are waiting. For anything urgent, use your radio.',
  },
];

export default function CrewHelp({ onClose, onOpenSettings, onRunSetup, gpsLabel, pushLabel }) {
  const native = isNative();
  const [openedUrl, setOpenedUrl] = useState(null);

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <div className="text-white font-bold text-base">❓ Help & Setup</div>
        <button onClick={onClose}
          className="text-gray-400 hover:text-white text-2xl w-11 h-11 flex items-center justify-center leading-none">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5 max-w-md w-full mx-auto">
        {native && (gpsLabel || pushLabel) && (
          <div className="rounded-2xl bg-gray-800 border border-gray-700 px-4 py-3 text-sm space-y-1">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">This phone right now</div>
            {gpsLabel && <div className="text-gray-200">📍 {gpsLabel}</div>}
            {pushLabel && <div className="text-gray-200">🔔 {pushLabel}</div>}
          </div>
        )}

        <div>
          <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Phone setup</div>
          <div className="space-y-3">
            {PLATFORM_STEPS.map(s => (
              <div key={`${s.key}-${s.title}`} className="rounded-2xl bg-gray-800 border border-gray-700 p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-2xl">{s.icon}</span>
                  <span className="text-white font-bold">{s.title}</span>
                </div>
                <div className="text-gray-300 text-sm leading-relaxed">{s.body}</div>
                {native && SETTINGS_STEPS.has(s.key) && (
                  <button onClick={onOpenSettings}
                    className="mt-3 w-full py-2.5 rounded-xl bg-blue-700 hover:bg-blue-600 text-white text-sm font-semibold">
                    Open Settings
                  </button>
                )}
                {native && s.links && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {s.links.map(l => (
                      <button key={l.url}
                        onClick={() => { window.location.href = l.url; setOpenedUrl(l.url); }}
                        className="flex-1 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-600 text-white text-sm font-semibold">
                        {l.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {openedUrl && <div className="text-gray-500 text-xs mt-2 text-center">Come back to this app when you're done in the watch app.</div>}
          {native && (
            <button onClick={onRunSetup}
              className="mt-3 w-full py-3 rounded-2xl bg-gray-800 border border-gray-600 text-gray-200 text-sm font-semibold hover:border-gray-400">
              ↻ Walk me through setup again
            </button>
          )}
        </div>

        <div>
          <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">If something's not working</div>
          <div className="space-y-2">
            {TIPS.map(t => (
              <details key={t.title} className="rounded-2xl bg-gray-800 border border-gray-700 px-4 py-3 group">
                <summary className="text-gray-100 text-sm font-semibold cursor-pointer list-none flex items-center gap-2">
                  <span>{t.icon}</span><span className="flex-1">{t.title}</span>
                  <span className="text-gray-500 group-open:rotate-90 transition-transform">›</span>
                </summary>
                <div className="text-gray-300 text-sm leading-relaxed mt-2">{t.body}</div>
              </details>
            ))}
          </div>
        </div>

        <div className="text-gray-600 text-xs text-center pb-4">Still stuck? Tell dispatch — they can see your phone's GPS and notification status.</div>
      </div>
    </div>
  );
}
