// Stale Cloudflare tunnels. A crash or a forced close skips will-quit, and on Windows the cloudflared we
// spawn is often a launcher (Chocolatey or Scoop shim) whose real tunnel is a child process: the
// tunnel then outlives Filow and keeps pointing at our ports. Only one Filow can hold these ports at a
// time, so at startup any cloudflared quick tunnel to one of our ports is stale.

/**
 * @param {string} listing one process per line: "<pid>\t<command line>"
 * @param {number[]} ports our local ports
 * @param {number} selfPid never returned
 * @returns {number[]} PIDs of cloudflared tunnels to our ports
 */
function staleTunnelPids(listing, ports, selfPid = process.pid) {
  const out = [];
  for (const line of String(listing).split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const pid = Number(line.slice(0, tab).trim());
    const cmd = line.slice(tab + 1);
    if (!Number.isInteger(pid) || pid <= 0 || pid === selfPid) continue;
    if (!/cloudflared/i.test(cmd) || !/\btunnel\b/.test(cmd)) continue;
    const m = cmd.match(/--url\s+"?https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/i);
    if (m && ports.includes(Number(m[1]))) out.push(pid);
  }
  return out;
}

/**
 * Does the public link start now that "Pair a phone" was opened? Yes when the user has it switched on
 * (the default), Filow may use the internet, the relay is this PC's own, and no link is up or coming
 * up. The link is never started at launch: nothing leaves the PC and no tool is fetched for a phone
 * nobody is pairing. A link that failed is tried again the next time the panel opens.
 *
 * @param {{ wanted: boolean, offline: boolean, hosted: boolean, state: string }} now
 *   wanted: settings.remoteShare; hosted: FILOW_SESSION_URL is set; state: off | downloading | connecting | on | error
 */
function linkStartsForPairing({ wanted, offline, hosted, state }) {
  return wanted === true && !offline && !hosted && (state === "off" || state === "error");
}

module.exports = { staleTunnelPids, linkStartsForPairing };
