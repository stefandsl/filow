import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { configuredCloud } from './config.mjs';
import { clientAddress } from './http.mjs';
const cloud = configuredCloud();
const assets = new Map([['/device',['device.html','text/html']],['/',['device.html','text/html']],['/done',['done.html','text/html']],['/client.mjs',['../dist/client.js','text/javascript']],['/style.css',['style.css','text/css']]]);
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url,cloud.origin);
    if (url.origin !== cloud.origin) { res.writeHead(400); return res.end(); }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const security = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
    const asset = assets.get(url.pathname);
    if (asset && req.method === 'GET') {
      res.writeHead(200,{...security,'Content-Type':`${asset[1]}; charset=utf-8`});
      return res.end(await readFile(new URL(`./public/${asset[0]}`,import.meta.url)));
    }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if(size > 1024*1024) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
    const headers = new Headers();
    for(const [name,value] of Object.entries(req.headers)) if(value) headers.set(name,Array.isArray(value) ? value.join(',') : value);
    headers.set('x-filow-client-ip', clientAddress(req.socket.remoteAddress, req.headers['x-forwarded-for'], process.env.FILOW_TRUSTED_PROXY));
    const response = await cloud.handle(new Request(url,{method:req.method,headers,
      ...(['GET','HEAD'].includes(req.method) ? {} : { body:Buffer.concat(chunks) })}));
    const outputHeaders = {...security,...Object.fromEntries(response.headers)};
    const cookies = response.headers.getSetCookie(); if(cookies.length) outputHeaders['set-cookie'] = cookies;
    res.writeHead(response.status,outputHeaders); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end('{"error":"service_unavailable"}'); }
});
server.requestTimeout = 30_000;
server.listen(Number(process.env.PORT || 4780),process.env.HOST || '127.0.0.1');
