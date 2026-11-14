// The ports Filow's own servers listen on (the app server and the session relay) may already be held
// by another program. The app server, started inside this process, ends the whole process when its
// port is taken: Filow showed its splash for a second and vanished without a word. The relay's port
// left the splash up for minutes instead. main.js asks here first and says which port is taken.
const net = require("node:net");

/**
 * True when this process can listen on `port` at `host` right now: a listen that is closed at once.
 * Any failure (in use, not permitted) counts as not free.
 */
function portFree(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

/**
 * The ports of `ports` that cannot be listened on at one of `hosts`, in the order given. More than
 * one host because Windows lets a program hold 127.0.0.1:port while another listens on 0.0.0.0:port:
 * asked on 0.0.0.0 alone the port looks free, the servers start, and Filow's own window (which
 * always talks to 127.0.0.1) reaches the other program instead.
 */
async function takenPorts(ports, hosts) {
  const taken = [];
  for (const port of ports) {
    for (const host of hosts) {
      if (!(await portFree(port, host))) { taken.push(port); break; }
    }
  }
  return taken;
}

module.exports = { portFree, takenPorts };
