/**
 * @file api.js
 * @description Standardized API fetch client with error normalization and request serialization.
 */

(function (window) {
  'use strict';

  class ApiClient {
    async request(url, options = {}) {
      const config = {
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        },
        ...options
      };

      if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
      }

      try {
        const response = await fetch(url, config);
        const text = await response.text();
        let data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch (e) {
          data = { success: false, raw: text };
        }

        if (!response.ok) {
          const errorMsg = data.error || data.message || `Request failed with status ${response.status}`;
          const err = new Error(errorMsg);
          err.status = response.status;
          err.data = data;
          err.terminal3Blocked = !!data.terminal3Blocked;
          throw err;
        }

        return data;
      } catch (err) {
        if (!err.status) {
          err.message = err.message || 'Network connection error. Please verify localhost server is running.';
        }
        throw err;
      }
    }

    get(url, params = {}) {
      const query = new URLSearchParams(params).toString();
      const fullUrl = query ? `${url}?${query}` : url;
      return this.request(fullUrl, { method: 'GET' });
    }

    post(url, body = {}) {
      return this.request(url, { method: 'POST', body });
    }

    put(url, body = {}) {
      return this.request(url, { method: 'PUT', body });
    }

    delete(url) {
      return this.request(url, { method: 'DELETE' });
    }
  }

  window.apiClient = new ApiClient();
})(window);
