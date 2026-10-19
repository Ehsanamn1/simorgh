import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.env.MEDAR_PRIVATE_FILES_DIR || './var/private-files');

function resolveKey(key) {
  if (typeof key !== 'string' || !key || key.includes('\\0')) {
    throw new Error('Invalid private file key');
  }
  const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Private file path escapes storage root');
  }
  return target;
}

export const privateFileStore = {
  async put(key, value, options = {}) {
    const target = resolveKey(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = target + '.tmp-' + crypto.randomUUID();
    await writeFile(temp, Buffer.from(value), { mode: 0o600, flag: 'wx' });
    await rename(temp, target);
    const meta = { contentType: options.httpMetadata?.contentType || 'application/octet-stream' };
    await writeFile(target + '.meta.json', JSON.stringify(meta), { mode: 0o600 });
    return { key };
  },
  async get(key) {
    const target = resolveKey(key);
    let stat;
    try { stat = await readFile(target); } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    let metadata = {};
    try { metadata = JSON.parse(await readFile(target + '.meta.json', 'utf8')); } catch { /* Fall back to a safe generic content type. */ }
    const body = Readable.toWeb(Readable.from([stat]));
    return {
      body,
      httpMetadata: { contentType: metadata.contentType || 'application/octet-stream' },
      writeHttpMetadata(headers) {
        headers.set('content-type', metadata.contentType || 'application/octet-stream');
      },
    };
  },
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const target = resolveKey(key);
      await rm(target, { force: true });
      await rm(target + '.meta.json', { force: true });
    }
  },
};

export function privateFilesRoot() {
  return root;
}
