'use strict';

/**
 * lib/runtime/engine.js
 * 
 * Google Antigravity 2.x Chinese Localization DOM Translation Engine (R2)
 * 
 * Core Features:
 * 1. Root Observation:
 *    - Immediately attaches MutationObserver to document.documentElement at document_start.
 *    - Eliminates "TypeError: Cannot read properties of null" when document.body is null.
 *    - Catches <body> and all subtree nodes as they are appended to the DOM.
 * 2. Shadow DOM Interception:
 *    - Monkey-patches Element.prototype.attachShadow.
 *    - Intercepts and observes newly created ShadowRoot instances for both mode: 'open' and mode: 'closed'.
 *    - Recursively covers nested Web Components.
 *    - Returns original ShadowRoot instance untouched so component lifecycle is never broken.
 * 3. Chinese IME Input Safety:
 *    - Captures compositionstart and compositionend events on window in the capture phase.
 *    - Enforces isImeComposing state lock.
 *    - Suspends translation mutations during active composition to prevent candidate box dropping or keystroke loss.
 * 4. Code Block & Editable Protection:
 *    - Strictly skips text nodes inside <pre>, <code>, <samp>, <kbd>, <script>, <style>, <textarea>, <input>.
 *    - Strictly skips .monaco-editor, .cm-editor, .xterm, and [contenteditable] elements.
 *    - Translates non-code UI attributes (placeholder, title, aria-label) on allowed elements.
 *    - Strictly protects non-translatable attributes (value, id, class, name, data-*).
 * 5. Loop Prevention & Performance:
 *    - Uses dual WeakMap caches (translatedCache and originalCache) to track translated nodes.
 *    - Uses isMutatingDom boolean mutex to eliminate infinite MutationObserver recursion (reentrancy count = 0).
 *    - Batches high-frequency mutations with requestIdleCallback (fallback to setTimeout) respecting 16ms frame deadlines.
 * 6. Precedence & Preload Export:
 *    - Translation precedence: Exact static match (menu, sidebar, settings, common) -> Parameterized regex matching (regex.json).
 *    - Attaches window.__ANTIGRAVITY_ZH_ENGINE__ for introspection and testability.
 *    - Provides getInjectedPreloadSource(dictionaries) to return standalone JavaScript code string for dist/preload.js.
 */

const fs = require('fs');
const path = require('path');

const PROTECTED_TAGS = new Set([
  'PRE', 'CODE', 'SAMP', 'KBD', 'SCRIPT', 'STYLE',
  'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT'
]);

const PROTECTED_SELECTORS = [
  'pre',
  'code',
  'samp',
  'kbd',
  '.monaco-editor',
  '.monaco-diff-editor',
  '.cm-editor',
  '.cm-content',
  '.cm-line',
  '.xterm',
  '.xterm-screen',
  '.terminal',
  '.code-line',
  '.code-block',
  '.line-content',
  '[aria-label="File Viewer"]',
  '[data-file-uri]',
  '[class*="diffEditor"]',
  '.token',
  '.hljs',
  '[class*="mtk"]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[data-notranslate="true"]',
  '.notranslate'
].join(',');

const TRANSLATABLE_ATTRS = new Set(['placeholder', 'title', 'aria-label']);

/**
 * Main DOM Translation Engine Class.
 */
class TranslationEngine {
  /**
   * Normalizes text for dictionary matching by collapsing whitespaces,
   * converting curly quotes to ASCII, and normalizing ellipsis.
   * @param {string} text
   * @returns {string}
   */
  static normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/\s+/g, ' ')
               .replace(/[‘’]/g, "'")
               .replace(/[“”]/g, '"')
               .replace(/…/g, '...')
               .trim();
  }

  /**
   * @param {object} [options]
   * @param {Window} [options.window] - Window context (defaults to global window if available)
   * @param {Document} [options.document] - Document context (defaults to global document)
   * @param {Record<string, Record<string, string>>} [options.dicts] - Dictionaries { menu, sidebar, settings, common, ... }
   * @param {Array<{ pattern: string, flags?: string, replace: string, description?: string }>} [options.regexRules]
   * @param {boolean} [options.autoInit=true] - Whether to automatically initialize observers
   */
  constructor(options = {}) {
    this.window = options.window || (typeof window !== 'undefined' ? window : null);
    this.document = options.document || (typeof document !== 'undefined' ? document : (this.window ? this.window.document : null));
    this.dicts = options.dicts || {};
    this.brandTitle = options.brandTitle || 'english';

    // Build lower-cased lookup map & longEntries sorted descending by length
    this.lowerMap = new Map();
    this.longEntries = [];
    const seenLongKeys = new Set();
    const dictOrder = ['menu', 'sidebar', 'settings', 'common'];

    for (const dictKey of dictOrder) {
      const d = this.dicts[dictKey];
      if (d) {
        for (const [k, v] of Object.entries(d)) {
          const normK = TranslationEngine.normalizeText(k);
          const lk = normK.toLowerCase();
          if (!this.lowerMap.has(lk)) this.lowerMap.set(lk, v);
          if (normK.length > 15 && !seenLongKeys.has(normK)) {
            seenLongKeys.add(normK);
            this.longEntries.push([normK, v]);
          }
        }
      }
    }
    for (const [key, d] of Object.entries(this.dicts)) {
      if (!dictOrder.includes(key) && key !== 'regex' && key !== 'regexRules' && d) {
        for (const [k, v] of Object.entries(d)) {
          const normK = TranslationEngine.normalizeText(k);
          const lk = normK.toLowerCase();
          if (!this.lowerMap.has(lk)) this.lowerMap.set(lk, v);
          if (normK.length > 15 && !seenLongKeys.has(normK)) {
            seenLongKeys.add(normK);
            this.longEntries.push([normK, v]);
          }
        }
      }
    }
    this.longEntries.sort((a, b) => b[0].length - a[0].length);

    const rawRules = options.regexRules || (this.dicts.regex || []);
    this.regexRules = rawRules.map(r => {
      try {
        return {
          re: new RegExp(r.pattern, r.flags || 'i'),
          replace: r.replace,
          description: r.description || ''
        };
      } catch (err) {
        return null;
      }
    }).filter(Boolean);

    this.translatedCache = new WeakMap();
    this.originalCache = new WeakMap();
    this.isMutatingDom = false;
    this.isImeComposing = false;
    this.pendingImeMutations = [];
    this.reentrancyCount = 0;
    this.translationMutationCount = 0;
    this.observedShadowRoots = new WeakSet();
    this.activeObservers = [];
    this.nodeQueue = new Set();
    this.idleCallbackId = null;
    this.version = '2.17.6';

    if (options.autoInit !== false) {
      this.init();
    }
  }

  /**
   * Initializes engine listeners and observers.
   */
  init() {
    this.setupImeGuard();
    this.setupShadowDomHook();
    this.setupRootObserver();

    if (this.window) {
      this.window.__ANTIGRAVITY_ZH_ENGINE__ = this;
    }
  }

  /**
   * Flushes buffered mutations accumulated during an IME composition session.
   */
  flushPendingImeMutations() {
    this.isImeComposing = false;
    if (this.pendingImeMutations && this.pendingImeMutations.length > 0) {
      const queued = this.pendingImeMutations;
      this.pendingImeMutations = [];
      this.handleMutations(queued);
    }
  }

  /**
   * Chinese IME Input Guard:
   * Listens for compositionstart and compositionend on window in the capture phase.
   * Suspends translation mutations when composition is active, buffering them for replay.
   */
  setupImeGuard() {
    if (!this.window || typeof this.window.addEventListener !== 'function') return;

    this.imeStartHandler = () => {
      this.isImeComposing = true;
    };

    this.imeEndHandler = () => {
      this.flushPendingImeMutations();
    };

    this.imeKeyHandler = (e) => {
      if (e && (e.key === 'Escape' || e.keyCode === 27)) {
        this.flushPendingImeMutations();
      }
    };

    this.imeBlurHandler = () => {
      this.flushPendingImeMutations();
    };

    this.window.addEventListener('compositionstart', this.imeStartHandler, true);
    this.window.addEventListener('compositionend', this.imeEndHandler, true);
    this.window.addEventListener('keydown', this.imeKeyHandler, true);
    this.window.addEventListener('blur', this.imeBlurHandler, true);
  }

  /**
   * Shadow DOM Interception:
   * 1. Monkey-patches Element.prototype.attachShadow in the current context.
   * 2. Injects a main-world hook across context isolation boundaries so Lit components
   *    in the renderer dispatch shadow creation events directly to this engine.
   */
  setupShadowDomHook() {
    const ElementClass = (this.window && this.window.Element) || (typeof Element !== 'undefined' ? Element : null);
    if (ElementClass && ElementClass.prototype) {
      const proto = ElementClass.prototype;
      const original = proto.attachShadow;
      if (typeof original === 'function') {
        const self = this;
        proto.attachShadow = function(init) {
          const shadowRoot = original.call(this, init);
          try {
            if (shadowRoot && !self.observedShadowRoots.has(shadowRoot)) {
              self.observedShadowRoots.add(shadowRoot);
              self.attachObserver(shadowRoot);
              self.processSubtree(shadowRoot);
            }
          } catch (err) {
            console.error('[TranslationEngine] Shadow hook error:', err);
          }
          return shadowRoot;
        };
      }
    }

    this.setupMainWorldShadowHook();
  }

  /**
   * Injects a main-world hook into the page context to bridge attachShadow calls
   * across Electron's contextIsolation barrier.
   */
  setupMainWorldShadowHook() {
    if (!this.window || typeof this.window.addEventListener !== 'function') return;

    this.shadowRootCreatedHandler = (e) => {
      try {
        const host = e && (e.detail || e.target);
        if (host && host.shadowRoot) {
          if (!this.observedShadowRoots.has(host.shadowRoot)) {
            this.observedShadowRoots.add(host.shadowRoot);
            this.attachObserver(host.shadowRoot);
          }
          this.processSubtree(host.shadowRoot);
        }
      } catch (_) {}
    };
    this.window.addEventListener('__ag_shadow_created__', this.shadowRootCreatedHandler, true);

    try {
      if (this.document) {
        const hookScript = this.document.createElement('script');
        hookScript.textContent = `
          (function() {
            if (window.__AG_SHADOW_HOOKED__) return;
            window.__AG_SHADOW_HOOKED__ = true;
            const orig = Element.prototype.attachShadow;
            Element.prototype.attachShadow = function(init) {
              const sr = orig.apply(this, arguments);
              try {
                window.dispatchEvent(new CustomEvent('__ag_shadow_created__', { detail: this }));
              } catch (_) {}
              return sr;
            };
          })();
        `;
        const parent = this.document.head || this.document.documentElement || this.document;
        if (parent && typeof parent.appendChild === 'function') {
          parent.appendChild(hookScript);
          if (typeof hookScript.remove === 'function') {
            hookScript.remove();
          }
        }
      }
    } catch (_) {}
  }

  /**
   * Root Observation:
   * Attaches MutationObserver to document.documentElement immediately at document_start.
   * Catches <body> and its children as they arrive.
   */
  setupRootObserver() {
    if (!this.document) return;

    const root = this.document.documentElement;
    if (root) {
      this.attachObserver(root);
      this.translateEntireDocument();
    }

    const startSweep = () => {
      try {
        const target = this.document.body || this.document.documentElement;
        if (target) {
          this.translateEntireDocument();
        }
      } catch (err) {}
    };

    if (this.window && typeof this.window.addEventListener === 'function') {
      if (this.document.readyState === 'loading') {
        this.document.addEventListener('DOMContentLoaded', startSweep, { once: true });
      } else {
        startSweep();
      }
      this.window.addEventListener('load', startSweep, { once: true });

      // Multi-stage timed sweeps for asynchronous web components / hydration
      const delays = [50, 150, 300, 600, 1200, 2500, 5000];
      for (const d of delays) {
        setTimeout(startSweep, d);
      }
    }
  }

  /**
   * Prunes disconnected observers from this.activeObservers to prevent memory leaks
   * when Web Components or ShadowRoots are removed from the DOM.
   */
  pruneDisconnectedObservers() {
    if (!this.activeObservers || this.activeObservers.length <= 1) return;
    const remaining = [];
    for (const obs of this.activeObservers) {
      const target = obs._target || obs.target;
      if (!target || target === this.document || (this.document && target === this.document.documentElement)) {
        remaining.push(obs);
        continue;
      }
      if (target.isConnected) {
        obs._wasConnected = true;
      }
      if (obs._wasConnected && target.isConnected === false) {
        try {
          obs.disconnect();
        } catch (_) {}
      } else {
        remaining.push(obs);
      }
    }
    this.activeObservers = remaining;
  }

  /**
   * Binds a MutationObserver to a target node (document.documentElement or ShadowRoot).
   * @param {Node} target
   * @returns {MutationObserver|null}
   */
  attachObserver(target) {
    if (!target) return null;
    this.pruneDisconnectedObservers();

    const ObserverClass = (this.window && this.window.MutationObserver) ||
      (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
    if (!ObserverClass) return null;

    const observer = new ObserverClass(records => {
      this.handleMutations(records);
    });
    observer._target = target;
    if (target.isConnected) {
      observer._wasConnected = true;
    }

    try {
      observer.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'title', 'aria-label']
      });
      this.activeObservers.push(observer);
    } catch (err) {
      console.error('[TranslationEngine] observe error:', err);
    }

    return observer;
  }

  /**
   * Determines whether a node or element must be skipped from translation.
   * @param {Node} node
   * @returns {boolean}
   */
  isProtected(node) {
    if (!node) return true;
    let curr = node.nodeType === 1 ? node : node.parentElement;
    if (!curr) return false;

    while (curr) {
      // Fast check for protected tag names
      if (curr.tagName && PROTECTED_TAGS.has(curr.tagName.toUpperCase())) {
        return true;
      }

      // Check contentEditable
      if (curr.isContentEditable) {
        return true;
      }
      if (typeof curr.getAttribute === 'function') {
        const ce = curr.getAttribute('contenteditable');
        if (ce === 'true' || ce === 'plaintext-only' || ce === '') {
          return true;
        }
      }

      // Check code editor / terminal container ancestors
      if (typeof curr.closest === 'function' && curr.closest(PROTECTED_SELECTORS)) {
        return true;
      }

      // Cross Shadow DOM boundary: traverse to host element if inside ShadowRoot
      const root = typeof curr.getRootNode === 'function' ? curr.getRootNode() : null;
      if (root && root !== curr && root.host) {
        curr = root.host;
      } else {
        break;
      }
    }

    return false;
  }

  /**
   * Looks up the translated string for a given text.
   * Precedence:
   * 1. Static exact match against dicts (menu, sidebar, settings, common, etc.)
   * 2. Parameterized sequential regex matching against regexRules
   * @param {string} text
   * @returns {string|null} Translated string, or null if no translation found
   */
  lookupTranslation(text) {
    if (!text || typeof text !== 'string') return null;
    const normalized = TranslationEngine.normalizeText(text);
    if (!normalized) return null;

    const leadingMatch = text.match(/^\s*/);
    const trailingMatch = text.match(/\s*$/);
    const leading = leadingMatch ? leadingMatch[0] : '';
    const trailing = trailingMatch ? trailingMatch[0] : '';

    const formatResult = (replacement) => {
      if (text.includes(normalized)) {
        return text.replace(normalized, replacement);
      }
      return leading + replacement + trailing;
    };

    // Brand title handling
    if (normalized.toLowerCase() === 'antigravity') {
      if (this.brandTitle === 'hidden') return formatResult('');
      if (this.brandTitle === 'english') return text;
      if (this.brandTitle === 'translated') return formatResult('反重力智能编程');
    }

    // 1. Static dictionary lookup in order of precedence: menu, sidebar, settings, common
    const dictOrder = ['menu', 'sidebar', 'settings', 'common'];
    for (const dictKey of dictOrder) {
      const dict = this.dicts[dictKey];
      if (dict && typeof dict[normalized] === 'string') {
        return formatResult(dict[normalized]);
      }
    }

    // Check any remaining dictionaries in this.dicts
    for (const [key, dict] of Object.entries(this.dicts)) {
      if (!dictOrder.includes(key) && key !== 'regex' && key !== 'regexRules' && dict && typeof dict[normalized] === 'string') {
        return formatResult(dict[normalized]);
      }
    }

    // 2. Case-insensitive fallback
    const lowerNorm = normalized.toLowerCase();
    if (this.lowerMap && this.lowerMap.has(lowerNorm)) {
      return formatResult(this.lowerMap.get(lowerNorm));
    }

    // 3. Keyboard shortcut suffix matching: e.g. "Command Palette (Ctrl+Shift+P)" or "New Tab (⌘T)"
    const shortcutMatch = normalized.match(/^(.+?)\s*\(((?:Ctrl|Cmd|Alt|Shift|⌘|⌥|⇧|⌃)(?:[+A-Za-z0-9_-]+)?)\)$/i);
    if (shortcutMatch) {
      const prefix = shortcutMatch[1].trim();
      const shortcutPart = shortcutMatch[2];
      const transPrefix = this.lookupTranslation(prefix);
      if (transPrefix) {
        return formatResult(`${transPrefix.trim()} (${shortcutPart})`);
      }
    }

    // 4. Dynamic regex rules
    for (const rule of this.regexRules) {
      if (rule.re.test(normalized)) {
        const translatedNorm = normalized.replace(rule.re, rule.replace);
        return formatResult(translatedNorm);
      }
    }

    // 5. Substring sliding match for long descriptive paragraphs (> 15 chars)
    if (this.longEntries && this.longEntries.length > 0) {
      for (const [key, replacement] of this.longEntries) {
        if (key.length > 15 && normalized.includes(key)) {
          const transNorm = normalized.replace(key, replacement);
          return formatResult(transNorm);
        }
      }
    }

    return null;
  }

  /**
   * Main MutationObserver callback.
   * Enforces IME lock and isMutatingDom mutex to prevent infinite loops.
   * @param {MutationRecord[]} records
   */
  handleMutations(records) {
    if (this.isImeComposing) {
      // IME session active: buffer mutations rather than dropping them
      if (Array.isArray(records)) {
        this.pendingImeMutations.push(...records);
      }
      return;
    }

    if (this.isMutatingDom) {
      // Mutex bail out: this mutation was generated by our own DOM write
      return;
    }

    for (const record of records) {
      if (record.type === 'characterData') {
        this.processTextNode(record.target);
      } else if (record.type === 'childList') {
        if (record.removedNodes && record.removedNodes.length > 0) {
          this.pruneDisconnectedObservers();
        }
        if (record.addedNodes) {
          for (const added of record.addedNodes) {
            this.processSubtree(added);
          }
        }
      } else if (record.type === 'attributes') {
        this.processAttribute(record.target, record.attributeName);
      }
    }
  }

  /**
   * Processes and translates an individual TextNode.
   * @param {Node} node
   */
  processTextNode(node) {
    if (!node || this.isProtected(node)) return;

    const currentText = node.textContent;
    if (currentText === undefined || currentText === null) return;

    // Protect skeleton loading placeholders
    if (currentText.includes('pack.info')) {
      const parent = node.parentElement;
      if (parent && typeof parent.setAttribute === 'function') {
        parent.setAttribute('translate', 'no');
      }
      return;
    }

    // WeakMap cache hit: if node already holds this translated text, skip
    if (this.translatedCache.get(node) === currentText) {
      return;
    }

    const translated = this.lookupTranslation(currentText);
    if (translated && translated !== currentText) {
      if (this.isMutatingDom) {
        this.reentrancyCount++;
        return;
      }
      this.isMutatingDom = true;
      try {
        this.originalCache.set(node, currentText);
        this.translatedCache.set(node, translated);
        node.textContent = translated;
        this.translationMutationCount++;
      } finally {
        this.isMutatingDom = false;
      }
    } else {
      this.translatedCache.set(node, currentText);
    }
  }

  /**
   * Processes and translates translatable attributes on an element.
   * Strictly ignores non-translatable attributes (value, id, class, name, data-*).
   * @param {Element} element
   * @param {string} attrName
   */
  processAttribute(element, attrName) {
    if (!element || element.nodeType !== 1 || !attrName) return;
    const lower = attrName.toLowerCase();
    if (!TRANSLATABLE_ATTRS.has(lower)) return;

    // Skip placeholder on code editors or internal editor inputareas
    if (lower === 'placeholder') {
      if (element.classList && typeof element.classList.contains === 'function' && element.classList.contains('inputarea')) {
        return;
      }
      if (typeof element.closest === 'function' && element.closest('.monaco-editor, .cm-editor')) {
        return;
      }
    }

    const currentVal = element.getAttribute(lower);
    if (!currentVal) return;

    if (this.translatedCache.get(element) === currentVal) {
      return;
    }

    const translated = this.lookupTranslation(currentVal);
    if (translated && translated !== currentVal) {
      if (this.isMutatingDom) {
        this.reentrancyCount++;
        return;
      }
      this.isMutatingDom = true;
      try {
        this.translatedCache.set(element, translated);
        element.setAttribute(lower, translated);
        this.translationMutationCount++;
      } finally {
        this.isMutatingDom = false;
      }
    } else {
      this.translatedCache.set(element, currentVal);
    }
  }

  /**
   * Recursively processes a subtree node.
   * @param {Node} node
   */
  processSubtree(node) {
    if (!node) return;

    if (node.nodeType === 3) {
      // Text node
      if (this.isProtected(node)) return;
      this.processTextNode(node);
    } else if (node.nodeType === 1 || node.nodeType === 11) {
      // Element node or DocumentFragment / ShadowRoot
      if (node.nodeType === 1) {
        for (const attr of TRANSLATABLE_ATTRS) {
          if (typeof node.hasAttribute === 'function' && node.hasAttribute(attr)) {
            this.processAttribute(node, attr);
          }
        }
      }

      // If container is protected (code block, editor, contenteditable), skip children
      if (this.isProtected(node)) return;

      // Piercing Shadow DOM: observe and recursively translate ShadowRoot
      if (node.shadowRoot) {
        if (!this.observedShadowRoots.has(node.shadowRoot)) {
          this.observedShadowRoots.add(node.shadowRoot);
          this.attachObserver(node.shadowRoot);
        }
        this.processSubtree(node.shadowRoot);
      }

      if (node.childNodes) {
        for (const child of node.childNodes) {
          this.processSubtree(child);
        }
      }
    }
  }

  /**
   * Schedules an idle batch callback respecting 16ms frame deadlines.
   * @param {function} callback
   * @returns {number}
   */
  scheduleIdleBatch(callback) {
    const scheduler = (this.window && this.window.requestIdleCallback) ||
      (typeof requestIdleCallback !== 'undefined' ? requestIdleCallback : null) ||
      ((cb) => setTimeout(() => cb({ timeRemaining: () => 15, didTimeout: false }), 16));

    return scheduler(callback, { timeout: 100 });
  }

  /**
   * Queues a node for batched translation during idle periods.
   * @param {Node} node
   */
  queueNodeForTranslation(node) {
    if (!node || this.isProtected(node)) return;
    this.nodeQueue.add(node);
    if (!this.idleCallbackId) {
      this.idleCallbackId = this.scheduleIdleBatch((deadline) => {
        this.idleCallbackId = null;
        this.processBatchQueue(deadline);
      });
    }
  }

  /**
   * Processes the translation queue up to the frame deadline (16ms).
   * @param {{ timeRemaining: () => number, didTimeout: boolean }} deadline
   */
  processBatchQueue(deadline) {
    for (const node of this.nodeQueue) {
      if (deadline && typeof deadline.timeRemaining === 'function') {
        if (deadline.timeRemaining() <= 0 && !deadline.didTimeout) {
          // Time expired for this frame, reschedule remainder
          this.idleCallbackId = this.scheduleIdleBatch((d) => {
            this.idleCallbackId = null;
            this.processBatchQueue(d);
          });
          return;
        }
      }

      this.nodeQueue.delete(node);
      if (node.isConnected !== false) {
        if (node.nodeType === 3) {
          this.processTextNode(node);
        } else if (node.nodeType === 1 || node.nodeType === 11) {
          this.processSubtree(node);
        }
      }
    }
  }

  /**
   * Scans and translates the entire document from documentElement.
   */
  translateEntireDocument() {
    if (this.document && this.document.documentElement) {
      this.processSubtree(this.document.documentElement);
    }
  }

  /**
   * Disconnects all observers and removes event listeners.
   */
  disconnect() {
    for (const obs of this.activeObservers) {
      try {
        obs.disconnect();
      } catch (_) {}
    }
    this.activeObservers = [];
    this.pendingImeMutations = [];

    if (this.window && typeof this.window.removeEventListener === 'function') {
      if (this.imeStartHandler) {
        this.window.removeEventListener('compositionstart', this.imeStartHandler, true);
      }
      if (this.imeEndHandler) {
        this.window.removeEventListener('compositionend', this.imeEndHandler, true);
      }
      if (this.imeKeyHandler) {
        this.window.removeEventListener('keydown', this.imeKeyHandler, true);
      }
      if (this.imeBlurHandler) {
        this.window.removeEventListener('blur', this.imeBlurHandler, true);
      }
      if (this.shadowRootCreatedHandler) {
        this.window.removeEventListener('__ag_shadow_created__', this.shadowRootCreatedHandler, true);
      }
    }
  }
}

/**
 * Creates a test translation harness conforming to test/tier3-dom and test/tier4-ime.
 * @param {object} env - Mock environment { window, document }
 * @param {object} dicts - Dictionaries object
 * @param {Array} regexRules - Regex rules array
 * @returns {TranslationEngine}
 */
function createTranslationHarness(env, dicts, regexRules) {
  return new TranslationEngine({
    window: env.window,
    document: env.document,
    dicts,
    regexRules
  });
}

/**
 * Loads default dictionaries from project dicts directory.
 * @returns {{ menu: object, sidebar: object, settings: object, common: object, regex: array }}
 */
function loadDefaultDictionaries() {
  const dictsDir = path.resolve(__dirname, '..', '..', 'dicts');
  const result = {
    menu: {},
    sidebar: {},
    settings: {},
    common: {},
    regex: []
  };

  const files = ['menu.json', 'sidebar.json', 'settings.json', 'common.json'];
  for (const file of files) {
    const key = path.basename(file, '.json');
    const p = path.join(dictsDir, file);
    if (fs.existsSync(p)) {
      try {
        result[key] = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (err) {
        console.warn(`[getInjectedPreloadSource] Failed to read ${file}:`, err.message);
      }
    }
  }

  const regexPath = path.join(dictsDir, 'regex.json');
  if (fs.existsSync(regexPath)) {
    try {
      result.regex = JSON.parse(fs.readFileSync(regexPath, 'utf8'));
    } catch (err) {
      console.warn(`[getInjectedPreloadSource] Failed to read regex.json:`, err.message);
    }
  }

  return result;
}

/**
 * Generates the standalone, self-executing JavaScript code string for injection into dist/preload.js.
 * Zero external dependencies: encapsulates all dictionaries, regex rules, and TranslationEngine logic.
 * 
 * @param {object} [dictionaries] - Optional custom dictionaries to embed. Defaults to project dicts.
 * @returns {string} Standalone injectable JavaScript code
 */
function getInjectedPreloadSource(dictionaries, options = {}) {
  let dictsToEmbed = dictionaries;
  if (!dictsToEmbed || Object.keys(dictsToEmbed).length === 0) {
    dictsToEmbed = loadDefaultDictionaries();
  }
  const brandTitle = (options && options.brandTitle) || 'english';

  const regexList = dictsToEmbed.regex || dictsToEmbed.regexRules || [];
  const staticDicts = {
    menu: dictsToEmbed.menu || {},
    sidebar: dictsToEmbed.sidebar || {},
    settings: dictsToEmbed.settings || {},
    common: dictsToEmbed.common || {}
  };

  for (const [k, v] of Object.entries(dictsToEmbed)) {
    if (k !== 'regex' && k !== 'regexRules' && !staticDicts[k] && typeof v === 'object' && v !== null) {
      staticDicts[k] = v;
    }
  }

  const serializedDicts = JSON.stringify(staticDicts);
  const serializedRegex = JSON.stringify(regexList);

  return `/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */
/**
 * Google Antigravity 2.x Chinese Localization Preload Engine
 * Injected into dist/preload.js at document_start
 * Version: 2.17.6
 */
(function __initAntigravityZhEngine__() {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__ANTIGRAVITY_ZH_ENGINE__) return;

  const PROTECTED_TAGS = new Set([
    'PRE', 'CODE', 'SAMP', 'KBD', 'SCRIPT', 'STYLE',
    'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT'
  ]);

  const PROTECTED_SELECTORS = [
    'pre',
    'code',
    'samp',
    'kbd',
    '.monaco-editor',
    '.monaco-diff-editor',
    '.cm-editor',
    '.cm-content',
    '.cm-line',
    '.xterm',
    '.xterm-screen',
    '.terminal',
    '.code-line',
    '.code-block',
    '.line-content',
    '[aria-label="File Viewer"]',
    '[data-file-uri]',
    '[class*="diffEditor"]',
    '.token',
    '.hljs',
    '[class*="mtk"]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[data-notranslate="true"]',
    '.notranslate'
  ].join(',');

  const TRANSLATABLE_ATTRS = new Set(['placeholder', 'title', 'aria-label']);

  ${TranslationEngine.toString()}

  try {
    const embeddedDicts = ${serializedDicts};
    const embeddedRegexRules = ${serializedRegex};

    const engine = new TranslationEngine({
      window: window,
      document: document,
      dicts: embeddedDicts,
      regexRules: embeddedRegexRules,
      brandTitle: '${brandTitle}'
    });

    window.__ANTIGRAVITY_ZH_ENGINE__ = engine;
  } catch (err) {
    console.error('[antigravity-zh] Failed to initialize runtime translation engine:', err);
  }
})();
/* --- ANTIGRAVITY CHINESE LOCALIZATION END --- */
`;
}

const SIGNATURE_START = "/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */";
const SIGNATURE_END = "/* --- ANTIGRAVITY CHINESE LOCALIZATION END --- */";

module.exports = {
  TranslationEngine,
  ReferenceTranslationEngine: TranslationEngine,
  createTranslationHarness,
  getInjectedPreloadSource,
  loadDefaultDictionaries,
  SIGNATURE_START,
  SIGNATURE_END,
  PROTECTED_TAGS,
  PROTECTED_SELECTORS,
  TRANSLATABLE_ATTRS
};
