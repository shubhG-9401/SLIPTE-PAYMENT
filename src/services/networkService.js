/**
 * @file networkService.js
 * @description Inspects local network adapters to resolve LAN/Wi-Fi IPv4 address for phone testing.
 */

const os = require('os');
const env = require('../config/env');

const networkService = {
  /**
   * Discovers the best LAN / Wi-Fi IP address for local mobile devices.
   * @param {number} [port]
   * @returns {Object} { ip, port, localUrl, lanUrl }
   */
  getLocalIpInfo(port = env.PORT) {
    const interfaces = os.networkInterfaces();
    let bestIp = '127.0.0.1';

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          bestIp = iface.address;
          // Prefer Wi-Fi or Ethernet interfaces
          if (/wi-?fi|ethernet|wlan/i.test(name)) {
            return {
              ip: bestIp,
              port,
              localUrl: `http://localhost:${port}`,
              lanUrl: `http://${bestIp}:${port}`
            };
          }
        }
      }
    }

    return {
      ip: bestIp,
      port,
      localUrl: `http://localhost:${port}`,
      lanUrl: `http://${bestIp}:${port}`
    };
  }
};

module.exports = networkService;
