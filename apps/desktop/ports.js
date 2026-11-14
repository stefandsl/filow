// The ports Filow's own servers listen on (the app server and the session relay) may already be held
// by another program. The app server, started inside this process, ends the whole process when its
// port is taken: Filow showed its splash for a second and vanished without a word. The relay's port
// left the splash up for minutes instead. main.js asks here first and says which port is taken.
const net = require("node:net");

/**
 * True when this process can listen on `port` at `host` right now: a listen that is closed at once.
 * Asked on the same host the servers bind, so the answer is the one they would get. Any failure
 * (in use, not permitted) counts as not free.
 */
function portFree(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}

/** The ports of `ports` that cannot be listened on at `host`, in the order given. */
async function takenPorts(ports, host) {
  const taken = [];
  for (const port of ports) if (!(await portFree(port, host))) taken.push(port);
  return taken;
}

module.exports = { portFree, takenPorts };
