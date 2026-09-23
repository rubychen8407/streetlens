const DB_NAME = 'streetlens-evidence';
const STORE_NAME = 'photos';
const DB_VERSION = 1;

function openEvidenceDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable in this browser'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('Unable to open evidence storage'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function storeEvidencePhoto(storageKey: string, blob: Blob): Promise<void> {
  const db = await openEvidenceDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, storageKey);
      tx.onerror = () => reject(tx.error || new Error('Unable to store evidence photo'));
      tx.oncomplete = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function getEvidencePhoto(storageKey: string): Promise<Blob | null> {
  const db = await openEvidenceDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(storageKey);
      request.onerror = () => reject(request.error || new Error('Unable to load evidence photo'));
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    });
  } finally {
    db.close();
  }
}

export async function deleteEvidencePhoto(storageKey: string): Promise<void> {
  const db = await openEvidenceDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(storageKey);
      tx.onerror = () => reject(tx.error || new Error('Unable to delete evidence photo'));
      tx.oncomplete = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function deleteEvidencePhotos(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return;
  const db = await openEvidenceDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const key of storageKeys) {
        store.delete(key);
      }
      tx.onerror = () => reject(tx.error || new Error('Unable to delete evidence photos'));
      tx.oncomplete = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function prepareEvidencePhoto(file: File): Promise<{
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
}> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image evidence is supported');
  }

  if (typeof createImageBitmap !== 'function') {
    return {
      blob: file,
      mimeType: file.type || 'image/jpeg',
      width: 0,
      height: 0,
    };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return {
      blob: file,
      mimeType: file.type || 'image/jpeg',
      width: 0,
      height: 0,
    };
  }

  try {
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    if (scale === 1 && file.size <= 2_000_000) {
      return {
        blob: file,
        mimeType: file.type || 'image/jpeg',
        width: bitmap.width,
        height: bitmap.height,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return {
        blob: file,
        mimeType: file.type || 'image/jpeg',
        width: bitmap.width,
        height: bitmap.height,
      };
    }

    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error('Unable to compress evidence photo')),
        'image/jpeg',
        0.78,
      );
    });

    return {
      blob,
      mimeType: 'image/jpeg',
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}

export async function loadEvidencePhotoUrl(storageKey: string): Promise<string | null> {
  const blob = await getEvidencePhoto(storageKey);
  return blob ? URL.createObjectURL(blob) : null;
}
