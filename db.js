// Tiny IndexedDB wrapper: stores "characters" (keyPath id) and "rules" (one record, key "all").
let dbp;
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open('dnd-cm', 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore('characters', { keyPath: 'id' });
    r.result.createObjectStore('rules');
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = (store, mode, fn) => (dbp ||= open()).then(db => new Promise((res, rej) => {
  const t = db.transaction(store, mode), req = fn(t.objectStore(store));
  t.oncomplete = () => res(req.result);
  t.onerror = t.onabort = () => rej(t.error);
}));

export const get = (s, k) => tx(s, 'readonly', st => st.get(k));
export const getAll = s => tx(s, 'readonly', st => st.getAll());
export const put = (s, v, k) => tx(s, 'readwrite', st => st.put(v, k));
export const del = (s, k) => tx(s, 'readwrite', st => st.delete(k));
