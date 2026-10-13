/**
 * @file uiComponents.js
 * @description Reusable UI helper functions: Toasts, Confirmation Dialogs, SVG Timer Ring, Auto-Reconnecting WebSocket, Table Controller.
 */

(function (window, document) {
  'use strict';

  // -------------------------------------------------------------------------
  // 1. Toast Notification Manager
  // -------------------------------------------------------------------------
  let toastContainer = null;

  function ensureToastContainer() {
    if (!toastContainer || !document.body.contains(toastContainer)) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toastContainer';
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  function showToast(message, type = 'info', customIcon = null) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = customIcon;
    if (!icon) {
      if (type === 'success') icon = '✓';
      else if (type === 'error') icon = '✕';
      else icon = 'ℹ️';
    }

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-msg">${message}</span>
      <button type="button" class="toast-close" aria-label="Close">&times;</button>
    `;

    container.appendChild(toast);

    function remove() {
      toast.classList.add('toast-hiding');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }

    toast.querySelector('.toast-close').addEventListener('click', remove);
    setTimeout(remove, 3500);
  }

  // -------------------------------------------------------------------------
  // 2. Confirmation Dialog
  // -------------------------------------------------------------------------
  function showConfirmDialog({
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    confirmText = 'Confirm',
    confirmClass = 'btn-danger',
    icon = '⚠️',
    onConfirm
  }) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
        <div class="confirm-icon">${icon}</div>
        <h3 id="confirmTitle" class="confirm-title">${title}</h3>
        <p class="confirm-desc">${message}</p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-secondary cancel-btn">Cancel</button>
          <button type="button" class="btn ${confirmClass} confirm-btn">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('.confirm-btn').addEventListener('click', () => {
      close();
      if (typeof onConfirm === 'function') onConfirm();
    });
  }

  // -------------------------------------------------------------------------
  // 3. Circular SVG Countdown Timer Ring
  // -------------------------------------------------------------------------
  function createTimerRing({ ringCircleEl, timerDigitsEl, duration = 120, onExpire, onTick }) {
    const circumference = 2 * Math.PI * 42; // r=42 -> ~263.89
    let timeLeft = duration;
    let interval = null;

    if (ringCircleEl) {
      ringCircleEl.style.strokeDasharray = `${circumference}`;
      ringCircleEl.style.strokeDashoffset = '0';
    }

    function render(sec) {
      const mins = Math.floor(sec / 60);
      const secs = sec % 60;
      const formatted = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;

      if (timerDigitsEl) {
        timerDigitsEl.textContent = formatted;
        if (sec <= 30) {
          timerDigitsEl.classList.add('urgent');
        } else {
          timerDigitsEl.classList.remove('urgent');
        }
      }

      if (ringCircleEl) {
        const fraction = Math.max(0, sec / duration);
        const offset = circumference * (1 - fraction);
        ringCircleEl.style.strokeDashoffset = `${offset}`;

        if (sec <= 30) {
          ringCircleEl.classList.add('urgent');
        } else {
          ringCircleEl.classList.remove('urgent');
        }
      }
    }

    render(timeLeft);

    function start() {
      clearInterval(interval);
      interval = setInterval(() => {
        timeLeft--;
        if (typeof onTick === 'function') onTick(timeLeft);

        if (timeLeft <= 0) {
          clearInterval(interval);
          render(0);
          if (typeof onExpire === 'function') onExpire();
        } else {
          render(timeLeft);
        }
      }, 1000);
    }

    function stop() {
      clearInterval(interval);
    }

    function reset(newDuration = duration) {
      stop();
      timeLeft = newDuration;
      render(timeLeft);
      start();
    }

    return { start, stop, reset, getTimeLeft: () => timeLeft };
  }

  // -------------------------------------------------------------------------
  // 3b. Horizontal Progress Bar Countdown Timer
  // -------------------------------------------------------------------------
  function createTimerBar({ fillEl, timerDigitsEl, duration = 120, onExpire, onTick }) {
    let timeLeft = duration;
    let interval = null;

    function render(sec) {
      const mins = Math.floor(sec / 60);
      const secs = sec % 60;
      const formatted = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;

      if (timerDigitsEl) {
        timerDigitsEl.textContent = formatted;
        if (sec <= 30) {
          timerDigitsEl.classList.add('urgent');
        } else {
          timerDigitsEl.classList.remove('urgent');
        }
      }

      if (fillEl) {
        const pct = Math.max(0, (sec / duration) * 100);
        fillEl.style.width = `${pct}%`;
        if (sec <= 30) {
          fillEl.classList.add('urgent');
        } else {
          fillEl.classList.remove('urgent');
        }
      }
    }

    render(timeLeft);

    function start() {
      clearInterval(interval);
      interval = setInterval(() => {
        timeLeft--;
        if (typeof onTick === 'function') onTick(timeLeft);

        if (timeLeft <= 0) {
          clearInterval(interval);
          render(0);
          if (typeof onExpire === 'function') onExpire();
        } else {
          render(timeLeft);
        }
      }, 1000);
    }

    function stop() {
      clearInterval(interval);
    }

    function reset(newDuration = duration) {
      stop();
      timeLeft = newDuration;
      render(timeLeft);
      start();
    }

    return { start, stop, reset, getTimeLeft: () => timeLeft };
  }

  // -------------------------------------------------------------------------
  // 4. Auto-Reconnecting WebSocket with Live Connection Badge
  // -------------------------------------------------------------------------
  function setupWebSocketWithBadge({ path = '', onMessage, onOpen, onClose, badgeEl }) {
    let ws = null;
    let retryTimeout = null;
    let retryDelay = 2000;
    const maxRetryDelay = 10000;
    let isExplicitlyClosed = false;

    function updateBadge(state) {
      if (!badgeEl) return;
      if (state === 'connected') {
        badgeEl.className = 'conn-badge connected';
        badgeEl.innerHTML = '<span class="dot"></span> Connected';
      } else if (state === 'connecting') {
        badgeEl.className = 'conn-badge connecting';
        badgeEl.innerHTML = '<span class="dot"></span> Connecting...';
      } else {
        badgeEl.className = 'conn-badge retrying';
        badgeEl.innerHTML = '<span class="dot"></span> Offline, retrying…';
      }
    }

    function connect() {
      if (isExplicitlyClosed) return;
      updateBadge('connecting');

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}${path}`;

      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = (e) => {
          retryDelay = 2000;
          updateBadge('connected');
          if (typeof onOpen === 'function') onOpen(ws, e);
        };

        ws.onmessage = (event) => {
          if (typeof onMessage === 'function') onMessage(event);
        };

        ws.onerror = () => {
          updateBadge('offline');
        };

        ws.onclose = (e) => {
          updateBadge('offline');
          if (typeof onClose === 'function') onClose(e);
          if (!isExplicitlyClosed) {
            clearTimeout(retryTimeout);
            retryTimeout = setTimeout(() => {
              retryDelay = Math.min(maxRetryDelay, retryDelay * 1.5);
              connect();
            }, retryDelay);
          }
        };
      } catch (err) {
        updateBadge('offline');
        clearTimeout(retryTimeout);
        retryTimeout = setTimeout(connect, retryDelay);
      }
    }

    connect();

    return {
      send(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(typeof data === 'string' ? data : JSON.stringify(data));
          return true;
        }
        return false;
      },
      close() {
        isExplicitlyClosed = true;
        clearTimeout(retryTimeout);
        if (ws) ws.close();
      },
      reconnect() {
        isExplicitlyClosed = false;
        connect();
      }
    };
  }

  // -------------------------------------------------------------------------
  // 5. Client Table Controller (Search, Status Filter, Pagination)
  // -------------------------------------------------------------------------
  function createTableController({
    tbodyEl,
    searchInputEl,
    filterSelectEl,
    prevBtnEl,
    nextBtnEl,
    pageInfoEl,
    renderRowHtml,
    emptyMessage = 'No records found.',
    pageSize = 6,
    initialData = []
  }) {
    let allData = [...initialData];
    let filteredData = [...initialData];
    let currentPage = 1;

    function applyFilterAndSearch() {
      const query = searchInputEl ? searchInputEl.value.trim().toLowerCase() : '';
      const filter = filterSelectEl ? filterSelectEl.value : 'all';

      filteredData = allData.filter(item => {
        // Status filter
        if (filter && filter !== 'all' && item.status !== filter) {
          return false;
        }
        // Search query
        if (query) {
          const str = JSON.stringify(item).toLowerCase();
          if (!str.includes(query)) return false;
        }
        return true;
      });

      currentPage = 1;
      render();
    }

    function render() {
      if (!tbodyEl) return;

      const totalItems = filteredData.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      currentPage = Math.min(currentPage, totalPages);

      const startIndex = (currentPage - 1) * pageSize;
      const pageItems = filteredData.slice(startIndex, startIndex + pageSize);

      if (pageItems.length === 0) {
        tbodyEl.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #64748b; padding: 24px;">${emptyMessage}</td></tr>`;
      } else {
        tbodyEl.innerHTML = pageItems.map((item, idx) => renderRowHtml(item, startIndex + idx)).join('');
      }

      if (pageInfoEl) {
        pageInfoEl.textContent = `Page ${currentPage} of ${totalPages} (${totalItems} total)`;
      }

      if (prevBtnEl) prevBtnEl.disabled = (currentPage <= 1);
      if (nextBtnEl) nextBtnEl.disabled = (currentPage >= totalPages);
    }

    if (searchInputEl) {
      searchInputEl.addEventListener('input', applyFilterAndSearch);
    }

    if (filterSelectEl) {
      filterSelectEl.addEventListener('change', applyFilterAndSearch);
    }

    if (prevBtnEl) {
      prevBtnEl.addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          render();
        }
      });
    }

    if (nextBtnEl) {
      nextBtnEl.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredData.length / pageSize);
        if (currentPage < totalPages) {
          currentPage++;
          render();
        }
      });
    }

    return {
      setData(newData) {
        allData = Array.isArray(newData) ? [...newData] : [];
        applyFilterAndSearch();
      },
      refresh() {
        render();
      }
    };
  }

  // Export to global scope
  window.uiComponents = {
    showToast,
    showConfirmDialog,
    createTimerRing,
    createTimerBar,
    setupWebSocketWithBadge,
    createTableController
  };

})(window, document);
