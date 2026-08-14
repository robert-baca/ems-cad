export function toRad(d) { return d * Math.PI / 180; }

export function getBearing(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const y = Math.sin(dLon) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

export function getDistanceFt(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const meters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(meters * 3.28084);
}

export function getCardinal(bearing) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(bearing / 45) % 8];
}
