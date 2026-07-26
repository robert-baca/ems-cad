import { useState } from 'react';

function CopyBox({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="mt-2 flex items-center gap-2 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2.5">
      <span className="font-mono text-green-400 text-sm flex-1 break-all leading-snug">{value}</span>
      <button
        onClick={copy}
        className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white px-2.5 py-1.5 rounded transition-colors flex-shrink-0 font-medium"
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}

const STEPS = {
  ios: [
    {
      title: 'Install Traccar Client',
      body: 'Search "Traccar Client" in the App Store and install the free app by Traccar LTD.',
    },
    {
      title: 'Open Settings in the app',
      body: 'Launch the app, tap the menu icon (≡) in the top-left, then tap Settings.',
    },
    {
      title: 'Enter your Device Identifier',
      body: 'Find "Device identifier" and type in your unit number exactly as shown:',
      copy: 'device_id',
    },
    {
      title: 'Enter the Server URL',
      body: 'Find "Server URL" and enter:',
      copy: 'server_url',
    },
    {
      title: 'Set Frequency & Motion Detection',
      body: 'Set Frequency to 30 seconds. Turn on Motion Detection to save battery. Set Stationary heartbeat seconds to 60 — this keeps sending a ping every minute while parked so dispatch doesn\'t see you go offline.',
    },
    {
      title: 'Allow Location — Always',
      body: 'Go to iPhone Settings → Privacy & Security → Location Services → Traccar Client → set to Always.',
    },
    {
      title: 'Tap the play button ▶',
      body: 'Back in Traccar Client, tap the green Start button. The bar will turn green when it\'s running.',
    },
  ],
  android: [
    {
      title: 'Install Traccar Client',
      body: 'Search "Traccar Client" on Google Play and install the free app by Traccar LTD.',
    },
    {
      title: 'Open Settings in the app',
      body: 'Launch the app, tap the three-line menu (≡) in the top-left, then tap Settings.',
    },
    {
      title: 'Enter your Device Identifier',
      body: 'Find "Device identifier" and type in your unit number exactly as shown:',
      copy: 'device_id',
    },
    {
      title: 'Enter the Server URL',
      body: 'Find "Server URL" and enter:',
      copy: 'server_url',
    },
    {
      title: 'Set Frequency to 30',
      body: 'Set Frequency to 30 seconds. Turn on Motion Detection — this pauses tracking when stationary and saves battery.',
    },
    {
      title: 'Allow Location — All the time',
      body: 'Go to phone Settings → Apps → Traccar Client → Permissions → Location → Allow all the time.',
    },
    {
      title: 'Toggle tracking ON',
      body: 'Back in Traccar Client, flip the main switch to ON. The switch turns blue when it\'s running.',
    },
  ],
};

export default function TraccarSetupModal({ deviceId, serverUrl, onClose }) {
  const [platform, setPlatform] = useState('ios');
  const steps = STEPS[platform];
  const values = { device_id: deviceId, server_url: serverUrl };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-gray-800 rounded-2xl border border-gray-700 w-full max-w-md shadow-2xl my-4">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-700">
          <div>
            <div className="text-white font-bold text-lg">GPS Setup Guide</div>
            <div className="text-gray-400 text-sm mt-0.5">Traccar Client — step by step</div>
          </div>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl flex-shrink-0">
            ×
          </button>
        </div>

        {/* Platform toggle */}
        <div className="px-5 pt-4">
          <div className="flex bg-gray-700 rounded-xl p-1 gap-1">
            {[['ios', '🍎 iPhone / iPad'], ['android', '🤖 Android']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPlatform(key)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  platform === key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Steps */}
        <div className="p-5 space-y-5">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold mt-0.5">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-semibold text-sm">{step.title}</div>
                <div className="text-gray-400 text-sm mt-0.5 leading-relaxed">{step.body}</div>
                {step.copy && <CopyBox value={values[step.copy]} />}
              </div>
            </div>
          ))}

          {/* Confirm tip */}
          <div className="bg-green-900/30 border border-green-700/50 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <span className="text-green-400 text-xl flex-shrink-0 leading-none mt-0.5">✓</span>
            <div>
              <div className="text-green-300 font-semibold text-sm">Confirm with dispatch</div>
              <div className="text-green-400/80 text-xs mt-0.5 leading-relaxed">
                Once tracking starts, tell your dispatcher to confirm your GPS dot is visible on the map before going into service.
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors"
          >
            Got It
          </button>
        </div>

      </div>
    </div>
  );
}
