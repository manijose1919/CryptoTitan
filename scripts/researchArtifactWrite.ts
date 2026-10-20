/**
 * Research artifact writer — /opt/cursor/artifacts may be a broken store symlink.
 * Prefer that path when writable; always mirror to /tmp/cryptotitan-artifacts.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const TMP_DIR = '/tmp/cryptotitan-artifacts';
const OPT_DIR = '/opt/cursor/artifacts';

export function writeResearchArtifact(filename: string, body: string): string[] {
  mkdirSync(TMP_DIR, { recursive: true });
  const written: string[] = [];
  const tmpPath = `${TMP_DIR}/${filename}`;
  writeFileSync(tmpPath, body);
  written.push(tmpPath);
  for (const dir of [OPT_DIR, '/cursor/stores/self/artifacts']) {
    try {
      mkdirSync(dir, { recursive: true });
      const p = `${dir}/${filename}`;
      writeFileSync(p, body);
      written.push(p);
    } catch (err) {
      console.warn(`artifact write skipped (${dir}):`, (err as Error).code ?? err);
    }
  }
  return written;
}
