/** Capture the centre crop shown by object-fit: cover, without UI controls. */
export function frameCrop(sw: number, sh: number, vw: number, vh: number) {
  if (![sw, sh, vw, vh].every(n => Number.isFinite(n) && n > 0)) throw new Error('相機尚未就緒。');
  const ratio = vw / vh;
  const width = Math.min(sw, sh * ratio), height = width / ratio;
  const scale = Math.min(1, 1280 / Math.max(width, height));
  return { x: (sw - width) / 2, y: (sh - height) / 2, width, height,
    outputWidth: Math.max(1, Math.round(width * scale)), outputHeight: Math.max(1, Math.round(height * scale)) };
}
export async function captureCameraFrame(video: HTMLVideoElement) {
  if (video.readyState < 2 || video.paused) throw new Error('相機畫面尚未就緒。');
  const crop = frameCrop(video.videoWidth, video.videoHeight, video.clientWidth, video.clientHeight);
  const canvas = document.createElement('canvas');
  canvas.width = crop.outputWidth; canvas.height = crop.outputHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('此瀏覽器無法擷取畫面。');
  context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
    if (value) resolve(value); else reject(new Error('畫面擷取失敗，請重試。'));
  }, 'image/jpeg', 0.72));
  if (blob.size > 2 * 1024 * 1024) throw new Error('畫面超過 2 MB，請重試。');
  return { blob, width: canvas.width, height: canvas.height };
}
