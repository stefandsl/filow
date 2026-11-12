import { expect, it } from 'vitest';
import { clientAddress } from './http.mjs';
it('takes the peer address unless a configured proxy supplied the forwarding header',()=>{
  expect(clientAddress('::ffff:192.0.2.1','203.0.113.9')).toBe('192.0.2.1');
  expect(clientAddress('127.0.0.1','fake, 203.0.113.9','127.0.0.1')).toBe('203.0.113.9');
  expect(clientAddress('127.0.0.1','invalid','127.0.0.1')).toBe('127.0.0.1');
});
