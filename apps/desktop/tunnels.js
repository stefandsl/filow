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

module.exports = { staleTunnelPids };
