import { isIP } from 'node:net';
export function clientAddress(remote, forwarded, trustedProxy = '') {
  const peer = (remote || '').replace(/^::ffff:/, '');
  // Trust only an explicitly configured immediate peer. Ignore user-supplied forwarding otherwise.
  if (trustedProxy && peer === trustedProxy && typeof forwarded === 'string') {
    const candidate = forwarded.split(',').at(-1).trim();
    if (isIP(candidate)) return candidate;
  }
  return isIP(peer) ? peer : '127.0.0.1';
}
