import { useState } from 'react';

const STEPS = [
  {
    key: 'location',
    icon: '📍',
    title: 'Location — Always',
    body: 'Required so your GPS dot shows on the dispatch map even when the screen is off.',
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
  },
];

export default function NativeSetupModal({ onDone }) {
  const [step, setStep]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);

  const current = STEPS[step];

  const handleStep = async () => {
    setLoading(true);
    try {
      if (current.key === 'location') {
        const { Geolocation } = await import('@capacitor/geolocation');
        await Geolocation.requestPermissions({ permissions: ['location'] });
      } else if (current.key === 'notifications') {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        await LocalNotifications.requestPermissions();
        // Create the channel immediately after permission is granted so it exists
        // with IMPORTANCE_MAX before any call notification is ever scheduled.
        const { createNotifChannel } = await import('../../hooks/useCrewNotifications');
        await createNotifChannel();
      }
      // battery step: instructions only, no plugin needed
    } catch {}
    setLoading(false);

    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      setDone(true);
      localStorage.setItem('native_setup_done', '1');
      onDone();
    }
  };

  if (done) return null;

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🚑</div>
          <div className="text-white font-bold text-xl">One-Time Setup</div>
          <div className="text-gray-400 text-sm mt-1">Allow these 3 things so GPS tracking works</div>
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

        <button
          onClick={handleStep}
          disabled={loading}
          className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white font-bold text-base rounded-2xl transition-colors"
        >
          {loading ? 'Opening…' : current.button}
        </button>

        {step === STEPS.length - 1 && (
          <button
            onClick={() => { localStorage.setItem('native_setup_done', '1'); onDone(); }}
            className="w-full mt-3 py-2.5 text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            Skip — I'll set it up later
          </button>
        )}
      </div>
    </div>
  );
}
