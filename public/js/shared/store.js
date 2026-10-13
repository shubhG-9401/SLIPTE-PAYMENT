/**
 * @file store.js
 * @description Lightweight reactive Pub/Sub state management store for frontend UI components.
 */

(function (window) {
  'use strict';

  /**
   * Creates a reactive state container.
   * @param {Object} initialState
   * @returns {Object} Store instance
   */
  function createStore(initialState = {}) {
    let state = Object.freeze({ ...initialState });
    const listeners = new Set();

    return {
      /**
       * Returns an immutable snapshot of current state.
       */
      getState() {
        return state;
      },

      /**
       * Merges updates into state and triggers registered subscribers.
       * @param {Object|Function} updater
       */
      setState(updater) {
        const prevState = state;
        const nextState = typeof updater === 'function' ? updater(prevState) : { ...prevState, ...updater };
        state = Object.freeze(nextState);
        listeners.forEach(fn => {
          try {
            fn(state, prevState);
          } catch (err) {
            console.error('[Store Error in listener]:', err);
          }
        });
      },

      /**
       * Subscribes a listener to state mutations.
       * @param {Function} listener (state, prevState) => void
       * @returns {Function} Unsubscribe callback
       */
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };
  }

  window.createStore = createStore;
})(window);
