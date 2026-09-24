/**
 * Lightweight, pure JavaScript DOM mock for testing runtime translation and IME protections.
 * Implements standard DOM node hierarchy, MutationObserver, Element.prototype.attachShadow,
 * and IME composition event dispatching without external dependencies.
 */

const activeObservers = new Set();

class MockNode {
  static get ELEMENT_NODE() { return 1; }
  static get TEXT_NODE() { return 3; }
  static get DOCUMENT_NODE() { return 9; }
  static get DOCUMENT_FRAGMENT_NODE() { return 11; }

  constructor(nodeType) {
    this.nodeType = nodeType;
    this.parentNode = null;
    this.parentElement = null;
    this.childNodes = [];
  }

  get isConnected() {
    let curr = this;
    while (curr) {
      if (curr.nodeType === MockNode.DOCUMENT_NODE) return true;
      curr = curr.parentNode || curr.host;
    }
    return false;
  }

  getRootNode() {
    let curr = this;
    while (curr.parentNode) {
      curr = curr.parentNode;
    }
    return curr;
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    child.parentElement = this.nodeType === MockNode.ELEMENT_NODE ? this : null;
    this.childNodes.push(child);

    dispatchMutation({
      type: 'childList',
      target: this,
      addedNodes: [child],
      removedNodes: []
    });

    return child;
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
      child.parentElement = null;

      dispatchMutation({
        type: 'childList',
        target: this,
        addedNodes: [],
        removedNodes: [child]
      });
      return child;
    }
    throw new Error('Node not found');
  }

  insertBefore(newChild, refChild) {
    if (!refChild) return this.appendChild(newChild);
    if (newChild.parentNode) newChild.parentNode.removeChild(newChild);

    const idx = this.childNodes.indexOf(refChild);
    if (idx === -1) throw new Error('refChild not found');

    newChild.parentNode = this;
    newChild.parentElement = this.nodeType === MockNode.ELEMENT_NODE ? this : null;
    this.childNodes.splice(idx, 0, newChild);

    dispatchMutation({
      type: 'childList',
      target: this,
      addedNodes: [newChild],
      removedNodes: []
    });
    return newChild;
  }
}

class MockTextNode extends MockNode {
  constructor(text = '') {
    super(MockNode.TEXT_NODE);
    this._text = String(text);
  }

  get textContent() {
    return this._text;
  }

  set textContent(val) {
    const old = this._text;
    this._text = String(val);
    if (old !== this._text) {
      dispatchMutation({
        type: 'characterData',
        target: this,
        oldValue: old
      });
    }
  }

  get nodeValue() {
    return this.textContent;
  }

  set nodeValue(val) {
    this.textContent = val;
  }
}

class MockElement extends MockNode {
  constructor(tagName) {
    super(MockNode.ELEMENT_NODE);
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.shadowRoot = null;
    this._classList = new Set();
    this.isContentEditable = false;
  }

  get classList() {
    const self = this;
    return {
      add(...classes) {
        classes.forEach(c => self._classList.add(c));
        self.attributes.set('class', Array.from(self._classList).join(' '));
      },
      remove(...classes) {
        classes.forEach(c => self._classList.delete(c));
        self.attributes.set('class', Array.from(self._classList).join(' '));
      },
      contains(c) {
        return self._classList.has(c);
      }
    };
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  set className(val) {
    this.setAttribute('class', val);
  }

  getAttribute(name) {
    return this.attributes.get(name.toLowerCase()) || null;
  }

  setAttribute(name, value) {
    const lower = name.toLowerCase();
    const strVal = String(value);
    this.attributes.set(lower, strVal);

    if (lower === 'class') {
      this._classList = new Set(strVal.split(/\s+/).filter(Boolean));
    } else if (lower === 'contenteditable') {
      this.isContentEditable = strVal === 'true' || strVal === 'plaintext-only';
    }

    dispatchMutation({
      type: 'attributes',
      target: this,
      attributeName: lower
    });
  }

  hasAttribute(name) {
    return this.attributes.has(name.toLowerCase());
  }

  removeAttribute(name) {
    const lower = name.toLowerCase();
    this.attributes.delete(lower);
    if (lower === 'class') {
      this._classList.clear();
    } else if (lower === 'contenteditable') {
      this.isContentEditable = false;
    }
  }

  get textContent() {
    return this.childNodes.map(c => c.textContent).join('');
  }

  set textContent(val) {
    // Remove all children
    while (this.childNodes.length > 0) {
      this.removeChild(this.childNodes[0]);
    }
    if (val !== '') {
      const textNode = new MockTextNode(val);
      this.appendChild(textNode);
    }
  }

  get children() {
    return this.childNodes.filter(c => c.nodeType === MockNode.ELEMENT_NODE);
  }

  closest(selectorString) {
    const selectors = selectorString.split(',').map(s => s.trim());

    function matchesOne(el, sel) {
      if (sel.startsWith('.')) {
        return el.classList.contains(sel.slice(1));
      }
      if (sel.startsWith('[') && sel.endsWith(']')) {
        const inner = sel.slice(1, -1);
        if (inner.includes('=')) {
          const [k, v] = inner.split('=');
          const cleanKey = k.trim().toLowerCase();
          const cleanVal = v.replace(/^["']|["']$/g, '').trim();
          return el.getAttribute(cleanKey) === cleanVal;
        }
        return el.hasAttribute(inner.toLowerCase());
      }
      // Tag selector
      return el.tagName.toLowerCase() === sel.toLowerCase();
    }

    let curr = this;
    while (curr && curr.nodeType === MockNode.ELEMENT_NODE) {
      for (const sel of selectors) {
        if (matchesOne(curr, sel)) return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  attachShadow(options = { mode: 'open' }) {
    const shadow = new MockShadowRoot(this, options.mode);
    this.shadowRoot = options.mode === 'open' ? shadow : null;
    return shadow;
  }
}

class MockShadowRoot extends MockNode {
  constructor(host, mode = 'open') {
    super(MockNode.DOCUMENT_FRAGMENT_NODE);
    this.host = host;
    this.mode = mode;
  }

  get isConnected() {
    return this.host ? this.host.isConnected : false;
  }
}

class MockDocument extends MockNode {
  constructor() {
    super(MockNode.DOCUMENT_NODE);
    this.documentElement = new MockElement('HTML');
    this.head = new MockElement('HEAD');
    this.body = new MockElement('BODY');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tagName) {
    return new MockElement(tagName);
  }

  createTextNode(text) {
    return new MockTextNode(text);
  }
}

class MockMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.target = null;
    this.options = null;
  }

  observe(target, options = {}) {
    this.target = target;
    this.options = {
      childList: !!options.childList,
      subtree: !!options.subtree,
      characterData: !!options.characterData,
      attributes: !!options.attributes,
      attributeFilter: options.attributeFilter || null
    };
    activeObservers.add(this);
  }

  disconnect() {
    activeObservers.delete(this);
    this.target = null;
  }
}

function dispatchMutation(record) {
  for (const obs of activeObservers) {
    if (!obs.target) continue;

    // Check if target is inside observed root
    let match = false;
    if (record.target === obs.target) {
      match = true;
    } else if (obs.options.subtree) {
      let curr = record.target;
      while (curr) {
        if (curr === obs.target) {
          match = true;
          break;
        }
        curr = curr.parentNode || curr.host;
      }
    }

    if (!match) continue;

    if (record.type === 'childList' && obs.options.childList) {
      obs.callback([record]);
    } else if (record.type === 'characterData' && obs.options.characterData) {
      obs.callback([record]);
    } else if (record.type === 'attributes' && obs.options.attributes) {
      if (
        !obs.options.attributeFilter ||
        obs.options.attributeFilter.includes(record.attributeName)
      ) {
        obs.callback([record]);
      }
    }
  }
}

class MockWindow {
  constructor(doc) {
    this.document = doc;
    this.listeners = new Map();
    this.Element = MockElement;
    this.Node = MockNode;
    this.MutationObserver = MockMutationObserver;
  }

  addEventListener(type, listener, optionsOrCapture) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.has(type)) {
      const arr = this.listeners.get(type).filter(fn => fn !== listener);
      this.listeners.set(type, arr);
    }
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const fn of list) {
      fn(event);
    }
  }

  requestIdleCallback(cb) {
    cb({
      timeRemaining: () => 15,
      didTimeout: false
    });
    return 1;
  }
}

function createMockEnvironment() {
  const document = new MockDocument();
  const window = new MockWindow(document);
  return { document, window, MockElement, MockTextNode, MockMutationObserver };
}

module.exports = {
  MockNode,
  MockTextNode,
  MockElement,
  MockShadowRoot,
  MockDocument,
  MockMutationObserver,
  MockWindow,
  createMockEnvironment
};
