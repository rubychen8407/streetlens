// Injected only by test-walk-ui.ts. permissionDenied is supplied by that harness.
const watchers = new Map();
let nextId = 0;
const position = (lat = 25.0326, lng = 121.5298, age = 0, accuracy = 12) => ({
  coords: { latitude: lat, longitude: lng, accuracy, heading: null, altitude: null, altitudeAccuracy: null, speed: null },
  timestamp: Date.now() - age,
});
const emit = (ok, fail) => permissionDenied
  ? fail?.({ code: 1, message: 'Denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
  : ok(position());
Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
  getCurrentPosition: (ok, fail) => setTimeout(() => emit(ok, fail), 0),
  watchPosition: (ok, fail) => {
    const id = ++nextId; watchers.set(id, { ok, fail });
    setTimeout(() => { if (watchers.has(id)) emit(ok, fail); }, 0); return id;
  }, clearWatch: id => watchers.delete(id),
} });
window.__emitFix = (lat, lng, age, accuracy) => {
  for (const watcher of watchers.values()) watcher.ok(position(lat, lng, age, accuracy));
};
window.__watchCount = () => watchers.size;
// Chromium supplies a fake camera only in this test harness.
window.__cameraTracks = [];
const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async constraints => {
  if (window.__denyCamera) throw new DOMException('Denied', 'NotAllowedError');
  const stream = await getMedia(constraints);
  window.__cameraTracks.push(...stream.getTracks());
  window.__cameraConstraints = constraints;
  return stream;
};
const original = Storage.prototype.setItem;
Storage.prototype.setItem = function(key, value) {
  if (window.__failStorage && key === 'cls_saved_locations') throw new DOMException('Full', 'QuotaExceededError');
  return original.call(this, key, value);
};
