// DP-3 — in-memory реалізація DP-3 drivePort-контракту для тестів.
// Нуль мережі/Drive; той самий контракт що createDefaultDrivePort.
let seq = 0;

export function createMemDrivePort() {
  const folders = new Map();   // id → { id, name, parentId }
  const files = new Map();     // id → { id, name, folderId, bytes, modifiedTime }
  const ROOT = '__root__';

  function findFolder(name, parentId) {
    for (const f of folders.values()) {
      if (f.name === name && f.parentId === (parentId || ROOT)) return f;
    }
    return null;
  }

  const port = {
    async getOrCreateFolder(name, parentId) {
      const pid = parentId || ROOT;
      let f = findFolder(name, pid);
      if (!f) { f = { id: `fold_${++seq}`, name, parentId: pid }; folders.set(f.id, f); }
      return { id: f.id };
    },
    async listFolder(folderId) {
      return Array.from(files.values())
        .filter((x) => x.folderId === folderId)
        .map((x) => ({ id: x.id, name: x.name, modifiedTime: x.modifiedTime, size: x.bytes.byteLength }));
    },
    async uploadText(folderId, name, content, mime) {
      return port.uploadBytes(folderId, name, new TextEncoder().encode(content), mime);
    },
    async readText(fileId) {
      const f = files.get(fileId);
      if (!f) throw new Error('not found');
      return new TextDecoder().decode(f.bytes);
    },
    async uploadBytes(folderId, name, bytes, mime) {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const id = `file_${++seq}`;
      files.set(id, { id, name, folderId, bytes: u8.slice(), modifiedTime: new Date(Date.now() + seq).toISOString() });
      return { id, name };
    },
    async readBytes(fileId) {
      const f = files.get(fileId);
      if (!f) throw new Error('not found');
      return f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength);
    },
    async deleteFile(fileId) { files.delete(fileId); },
    async quota() { return { usage: 0, limit: 100 * 1024 * 1024 * 1024, free: 100 * 1024 * 1024 * 1024, limitless: false }; },
  };

  // Інспекція для асертів.
  port._files = files;
  port._folders = folders;
  port._countFilesNamed = (n) => Array.from(files.values()).filter((f) => f.name === n).length;
  port._allNames = () => Array.from(files.values()).map((f) => f.name);
  return port;
}
