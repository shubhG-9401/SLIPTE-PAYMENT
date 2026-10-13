/**
 * @file networkService.js
 * @description Inspects local network adapters to resolve actual Wi-Fi/LAN IPv4 address for phone testing,
 * filtering out virtual adapters (VirtualBox, VMware, vEthernet, WSL, Host-Only).
 */

const os = require('os');
const env = require('../config/env');

const networkService = {
  /**
   * Discovers the best LAN / Wi-Fi IP address for local mobile devices.
   * @param {number} [port]
   * @returns {Object} { ip, port, localUrl, lanUrl, allIps }
   */
  getLocalIpInfo(port = env.PORT) {
    // 1. Allow explicit environment variable override
    if (process.env.LAN_IP && process.env.LAN_IP.trim()) {
      const explicitIp = process.env.LAN_IP.trim();
      return {
        ip: explicitIp,
        port,
        localUrl: `http://localhost:${port}`,
        lanUrl: `http://${explicitIp}:${port}`,
        allIps: [{ name: 'Custom LAN_IP', ip: explicitIp }]
      };
    }

    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const [name, list] of Object.entries(interfaces)) {
      if (!Array.isArray(list)) continue;

      for (const iface of list) {
        // Skip over non-IPv4, internal (127.0.0.1), or APIPA (169.254.x.x)
        if (iface.family !== 'IPv4' || iface.internal || (iface.address && iface.address.startsWith('169.254.'))) {
          continue;
        }

        let score = 0;
        const mac = (iface.mac || '').toLowerCase();
        const address = iface.address;

        // VirtualBox Host-Only detection (192.168.56.x or Oracle OUI 0a:00:27)
        const isVbox = address.startsWith('192.168.56.') || mac.startsWith('0a:00:27');

        // Virtual / Container / Hypervisor adapter name detection
        const isVirtualName = /virtual|vbox|vmware|vethernet|hyper-v|wsl|host-only|bluetooth|pseudo|tunnel|tap/i.test(name);

        if (isVbox || isVirtualName) {
          score -= 100;
        }

        // Active Wi-Fi interfaces receive highest priority
        if (/wi-?fi|wlan|wireless|802\.11/i.test(name)) {
          score += 60;
        } else if (/ethernet|lan|eth/i.test(name)) {
          score += 20;
        }

        // Standard private LAN subnets commonly assigned by home Wi-Fi routers
        if (address.startsWith('192.168.1.') || address.startsWith('192.168.0.') || address.startsWith('192.168.29.')) {
          score += 15;
        } else if (address.startsWith('192.168.') || address.startsWith('10.') || address.startsWith('172.')) {
          score += 5;
        }

        candidates.push({
          name,
          ip: address,
          mac,
          score
        });
      }
    }

    // Sort descending by priority score
    candidates.sort((a, b) => b.score - a.score);

    const validCandidates = candidates.filter(c => c.score > 0);
    const bestCandidate = validCandidates.length > 0 ? validCandidates[0] : (candidates[0] || { ip: '127.0.0.1' });

    return {
      ip: bestCandidate.ip,
      port,
      adapterName: bestCandidate.name,
      localUrl: `http://localhost:${port}`,
      lanUrl: `http://${bestCandidate.ip}:${port}`,
      allIps: candidates.map(c => ({ name: c.name, ip: c.ip, isSelected: c.ip === bestCandidate.ip }))
    };
  }
};

module.exports = networkService;
