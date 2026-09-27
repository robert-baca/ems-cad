import { useEffect, useRef, useState } from 'react';
import { decodeLicenseBarcode, parseLicense } from '../../lib/licenseScan';

// Full-screen camera view that reads the PDF417 barcode on the back of a
// driver's license / state ID and hands back PT NOTES fields. Everything is
// decoded on the phone; nothing is uploaded or saved. A "take a photo"
// fallback covers phones where the live view struggles (glare, focus).
export default function LicenseScanner({ onResult, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('starting'); // starting | scanning | blocked | unsupported | decoding
  const [hint, setHint] = useState('');

  const finish = (text) => {
    const fields = parseLicense(text);
    if (fields) { onResult(fields); return true; }
    setHint("That barcode isn't a license barcode — scan the big barcode on the back of the ID.");
    return false;
  };

  // Live camera + decode loop.
  useEffect(() => {
    let stream = null;
    let stopped = false;
    let timer = null;
    let busy = false;

    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!busy && video && canvas && video.readyState >= 2 && video.videoWidth) {
        busy = true;
        try {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0);
          const text = await decodeLicenseBarcode(ctx.getImageData(0, 0, canvas.width, canvas.height));
          if (text && !stopped && finish(text)) { stopped = true; return; }
        } catch (e) {
          console.warn('[license] decode failed', e);
        } finally {
          busy = false;
        }
      }
      timer = setTimeout(tick, 250);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus('unsupported'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            // PDF417 is dense -- ask for enough resolution to resolve it.
            width: { ideal: 1920 }, height: { ideal: 1080 },
          },
        });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        const track = stream.getVideoTracks()[0];
        // Continuous autofocus where the phone supports asking for it.
        track?.applyConstraints?.({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play().catch(() => {});
        setStatus('scanning');
        tick();
      } catch (e) {
        console.warn('[license] camera unavailable', e);
        setStatus(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'blocked' : 'unsupported');
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStatus(s => (s === 'scanning' ? s : 'decoding'));
    setHint('Reading photo…');
    try {
      const text = await decodeLicenseBarcode(file);
      if (!text) setHint("Couldn't find the barcode in that photo — fill the frame with the barcode on the back, no glare, and try again.");
      else if (finish(text)) return;
    } catch (err) {
      console.warn('[license] photo decode failed', err);
      setHint("Couldn't read that photo — try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 flex-shrink-0">
        <button onClick={onClose} className="text-gray-300 hover:text-white p-2 -ml-2 text-sm">Cancel</button>
        <span className="text-white font-bold text-base">Scan License</span>
        <div className="w-14" />
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        {status === 'scanning' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[88%] aspect-[3/1] border-2 border-green-400 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}
        {(status === 'blocked' || status === 'unsupported') && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-center text-gray-300 text-sm space-y-2">
              <div className="text-4xl">📷</div>
              {status === 'blocked'
                ? <p>Camera access is off for this app. Turn it on in your phone's Settings, or take a photo below.</p>
                : <p>Live scanning isn't available here — this may need the latest app update. Take a photo of the barcode below instead.</p>}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-3 flex-shrink-0 bg-black">
        <p className="text-gray-300 text-sm text-center">
          {hint || (status === 'scanning'
            ? 'Point at the barcode on the BACK of the license. Hold steady until it fills in.'
            : status === 'starting' ? 'Starting camera…' : '')}
        </p>
        <label className="block">
          <input type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
          <span className="block w-full py-3 rounded-xl bg-gray-800 text-gray-200 text-sm font-semibold text-center active:bg-gray-700">
            📸 Take a photo instead
          </span>
        </label>
        <p className="text-gray-500 text-[11px] text-center">Read on this phone only — nothing is uploaded or saved. License number isn't collected.</p>
      </div>
    </div>
  );
}
