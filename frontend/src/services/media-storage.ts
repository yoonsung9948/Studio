/** Binary media belongs in IndexedDB, never in the JSON workspace or localStorage. */
function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("dotori-media", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("media");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error("Media storage is unavailable."));
  });
}
export async function saveMediaBlob(id: string, blob: Blob) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("media", "readwrite");
      transaction.objectStore("media").put(blob, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(Error("Not enough browser storage to save this media."));
      transaction.onabort = () => reject(Error("Media could not be saved."));
    });
  } finally {
    db.close();
  }
}
export async function loadMediaBlob(id: string): Promise<Blob | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("media").objectStore("media").get(id);
      request.onsuccess = () => resolve(request.result as Blob | undefined);
      request.onerror = () =>
        reject(Error("Stored media could not be loaded."));
    });
  } finally {
    db.close();
  }
}
