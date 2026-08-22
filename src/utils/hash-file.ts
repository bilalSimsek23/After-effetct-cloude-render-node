import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** Streams a file through SHA-256 rather than reading it fully into memory. */
export function hashFileSha256(filePath: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}
