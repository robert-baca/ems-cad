// True push notifications — delivered by Apple/Google's own push
// infrastructure even if the app process has been fully force-closed,
// unlike the existing socket-driven LocalNotifications alerts (see
// CrewMobile.jsx's crew:attention_ping/call:assigned_to_me handlers), which
// only fire while this app's own process is still alive to receive the
// socket event in the first place.
//
// Android goes through Firebase Cloud Messaging. iOS goes directly to APNs
// (not through Firebase) -- @capacitor-community/fcm, the usual bridge for
// getting an FCM token on iOS, doesn't support this project's Swift Package
// Manager setup (CocoaPods-only), so iOS uses the raw APNs device token
// @capacitor/push-notifications already provides on that platform, sent
// straight to Apple's HTTP/2 API using the APNs auth key (.p8) uploaded to
// Apple Developer, rather than routing through Firebase.
const jwt = require('jsonwebtoken');
const http2 = require('http2');

let firebaseApp = null;
function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!raw) return null;
  try {
    // firebase-admin v14 dropped the legacy namespaced API
    // (admin.credential.cert / admin.messaging) -- modular imports only.
    const { initializeApp, cert } = require('firebase-admin/app');
    const serviceAccount = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    firebaseApp = initializeApp({ credential: cert(serviceAccount) });
    return firebaseApp;
  } catch (e) {
    console.error('[push] Failed to initialize Firebase Admin:', e.message);
    return null;
  }
}

// Must match NOTIF_CHANNEL_ID in the client's useCrewNotifications.js --
// without it FCM files the push under its default "Miscellaneous" channel,
// which doesn't get the heads-up banner or strong vibration (and so buzzes
// a paired watch much more weakly, if at all).
const ANDROID_CHANNEL_ID = 'ems-cad-headsup-v2';

async function sendAndroid(pushToken, title, body) {
  const app = getFirebaseApp();
  if (!app) {
    const error = process.env.FIREBASE_SERVICE_ACCOUNT_B64
      ? 'Server could not load Firebase credentials (see server log)'
      : 'Server is missing Firebase credentials';
    console.warn(`[push] ${error} — Android push skipped`);
    return { ok: false, error };
  }
  try {
    const { getMessaging } = require('firebase-admin/messaging');
    await getMessaging(app).send({
      token: pushToken,
      notification: { title, body },
      android: { priority: 'high', notification: { channelId: ANDROID_CHANNEL_ID } }
    });
    return { ok: true };
  } catch (e) {
    console.error('[push] Android send failed:', e.message);
    return { ok: false, error: e.code || e.message };
  }
}

// APNs wants its auth JWT reused across requests, not regenerated every
// time (Apple rate-limits how often a new one can be minted) -- cached and
// refreshed every 50 minutes, under Apple's ~60 minute recommended ceiling.
let apnsJwt = null;
let apnsJwtMintedAt = 0;
const APNS_JWT_MAX_AGE_MS = 50 * 60 * 1000;

function getApnsJwt() {
  const now = Date.now();
  if (apnsJwt && now - apnsJwtMintedAt < APNS_JWT_MAX_AGE_MS) return apnsJwt;
  const keyB64 = process.env.APNS_AUTH_KEY_B64;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  if (!keyB64 || !keyId || !teamId) return null;
  const privateKey = Buffer.from(keyB64, 'base64').toString('utf8');
  apnsJwt = jwt.sign({ iss: teamId, iat: Math.floor(now / 1000) }, privateKey, {
    algorithm: 'ES256',
    keyid: keyId
  });
  apnsJwtMintedAt = now;
  return apnsJwt;
}

// urgent = Time Sensitive: breaks through Focus / Do Not Disturb (and so
// still reaches a paired Apple Watch). Only takes effect once the installed
// app build carries the time-sensitive entitlement; older builds ignore it.
function sendIos(pushToken, title, body, urgent) {
  return new Promise((resolve) => {
    const token = getApnsJwt();
    const bundleId = process.env.APNS_BUNDLE_ID;
    if (!token || !bundleId) {
      console.warn('[push] APNs env vars not fully set — iOS push skipped');
      resolve({ ok: false, error: 'Server is missing APNs credentials' });
      return;
    }

    const client = http2.connect('https://api.push.apple.com:443');
    client.on('error', (e) => {
      console.error('[push] iOS connection error:', e.message);
      resolve({ ok: false, error: e.message });
    });

    const aps = { alert: { title, body }, sound: 'default' };
    if (urgent) aps['interruption-level'] = 'time-sensitive';
    const payload = JSON.stringify({ aps });
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${pushToken}`,
      'authorization': `bearer ${token}`,
      'apns-topic': bundleId,
      'apns-priority': '10',
      'apns-push-type': 'alert',
      'content-type': 'application/json'
    });

    let status = null;
    req.on('response', (headers) => { status = headers[':status']; });
    let responseBody = '';
    req.on('data', (chunk) => { responseBody += chunk; });
    req.on('end', () => {
      client.close();
      if (status !== 200) {
        console.error(`[push] iOS send failed: status=${status} body=${responseBody}`);
      }
      // APNs error bodies are {"reason":"BadDeviceToken"} etc. -- surface
      // the reason itself so a failed test push says *why*.
      let reason = null;
      try { reason = JSON.parse(responseBody).reason; } catch {}
      resolve(status === 200 ? { ok: true } : { ok: false, error: reason || `HTTP ${status}` });
    });
    req.on('error', (e) => {
      console.error('[push] iOS request error:', e.message);
      client.close();
      resolve({ ok: false, error: e.message });
    });

    req.write(payload);
    req.end();
  });
}

// Returns true if a push was actually sent (not just attempted) — callers
// shouldn't treat false as an error worth surfacing to the user, since a
// unit with no registered device (never opened the app since this feature
// shipped) is an expected, common case, not a failure.
async function sendPushToUnit(unit, message) {
  return (await sendPushToUnitDetailed(unit, message)).ok;
}

// Same as sendPushToUnit, but keeps Apple's/Google's actual failure reason
// (e.g. BadDeviceToken, registration-token-not-registered) -- used by the
// dispatcher's Test Push button so a failure is diagnosable, not just "no".
// urgent: reserved for the alerts a crew member must not miss -- new call
// assignments, dispatch pinging them, and park-wide broadcasts.
async function sendPushToUnitDetailed(unit, { title, body, urgent = false }) {
  if (!unit?.push_token || !unit?.push_platform) return { ok: false, error: 'No phone registered for push on this unit' };
  if (unit.push_platform === 'ios') return sendIos(unit.push_token, title, body, urgent);
  if (unit.push_platform === 'android') return sendAndroid(unit.push_token, title, body);
  return { ok: false, error: `Unknown platform ${unit.push_platform}` };
}

module.exports = { sendPushToUnit, sendPushToUnitDetailed };
