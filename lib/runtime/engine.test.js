'use strict';

/**
 * lib/runtime/engine.test.js
 * 
 * Exhaustive unit and integration test suite for lib/runtime/engine.js.
 * Verifies all R2 requirements:
 * 1. Root observation at document_start (body is null).
 * 2. Shadow DOM interception (open and closed roots, preserving return value).
 * 3. Chinese IME input protection (compositionstart/compositionend mutex lock).
 * 4. Code & editable protection (<pre>, <code>, .monaco-editor, .cm-editor, contenteditable).
 * 5. Loop prevention & WeakMap caching (re-entrancy count is strictly 0).
 * 6. Translation lookup precedence and getInjectedPreloadSource execution in VM sandbox.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const {
  TranslationEngine,
  createTranslationHarness,
  getInjectedPreloadSource,
  loadDefaultDictionaries,
  PROTECTED_TAGS,
  PROTECTED_SELECTORS,
  TRANSLATABLE_ATTRS
} = require('./engine');

const { createMockEnvironment } = require('../../test/helpers/mock-dom');

function loadFixtures() {
  const dictsDir = path.join(__dirname, '..', '..', 'test', 'fixtures', 'dicts');
  const menu = JSON.parse(fs.readFileSync(path.join(dictsDir, 'menu.json'), 'utf8'));
  const sidebar = JSON.parse(fs.readFileSync(path.join(dictsDir, 'sidebar.json'), 'utf8'));
  const settings = JSON.parse(fs.readFileSync(path.join(dictsDir, 'settings.json'), 'utf8'));
  const common = JSON.parse(fs.readFileSync(path.join(dictsDir, 'common.json'), 'utf8'));
  const regexRules = JSON.parse(fs.readFileSync(path.join(dictsDir, 'regex.json'), 'utf8'));

  return {
    dicts: { menu, sidebar, settings, common },
    regexRules
  };
}

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    console.error(`  \x1b[31m✘\x1b[0m ${name}: ${err.message}`);
    if (err.stack) {
      console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n    ')}`);
    }
  }
}

console.log('\n============================================================');
console.log(' lib/runtime/engine.js Exhaustive Self-Verification Suite');
console.log('============================================================\n');

const { dicts, regexRules } = loadFixtures();

// 1. Root Observation & Early Preload (Body is Null)
it('R2.1: Attaches to document.documentElement when body is strictly null without throwing', () => {
  const env = createMockEnvironment();
  // Simulate early document_start: body is not created yet
  env.document.documentElement.removeChild(env.document.body);
  env.document.body = null;
  assert.strictEqual(env.document.body, null, 'Precondition: document.body must be null');

  // Should NOT throw "TypeError: Cannot read properties of null"
  const engine = new TranslationEngine({
    window: env.window,
    document: env.document,
    dicts,
    regexRules
  });
  assert.ok(engine, 'Engine initialized successfully at document_start');

  // Later in document lifecycle, body arrives as child of documentElement
  const body = env.document.createElement('BODY');
  env.document.body = body;
  env.document.documentElement.appendChild(body);

  const span = env.document.createElement('SPAN');
  span.textContent = 'File';
  body.appendChild(span);

  assert.strictEqual(span.textContent, '文件', 'Subtree nodes added to body after early init must be translated');
});

// 2. Plain Text Translation
it('R2.1: Translates plain text nodes using dictionary terms (exact match)', () => {
  const env = createMockEnvironment();
  const engine = createTranslationHarness(env, dicts, regexRules);

  const span = env.document.createElement('SPAN');
  span.textContent = 'File';
  env.document.body.appendChild(span);
  assert.strictEqual(span.textContent, '文件');

  const btn = env.document.createElement('BUTTON');
  btn.textContent = 'Save';
  env.document.body.appendChild(btn);
  assert.strictEqual(btn.textContent, '保存');
});

// 3. Dynamic Regex Translation
it('R2.6: Translates dynamic strings using regex rules with capture groups', () => {
  const env = createMockEnvironment();
  const engine = createTranslationHarness(env, dicts, regexRules);

  const div = env.document.createElement('DIV');
  div.textContent = '3 agents running';
  env.document.body.appendChild(div);
  assert.strictEqual(div.textContent, '3 个正在运行的智能体');
});

// 4. UI Attribute Translation & Protection
it('R2.4: Translates UI attributes (placeholder, title, aria-label)', () => {
  const env = createMockEnvironment();
  const engine = createTranslationHarness(env, dicts, regexRules);

  const input = env.document.createElement('INPUT');
  input.setAttribute('placeholder', 'Ask Antigravity...');
  env.document.body.appendChild(input);
  assert.strictEqual(input.getAttribute('placeholder'), '向 Antigravity 提问...');

  const closeBtn = env.document.createElement('BUTTON');
  closeBtn.setAttribute('title', 'Close');
  env.document.body.appendChild(closeBtn);
  assert.strictEqual(closeBtn.getAttribute('title'), '关闭');

  const actionDiv = env.document.createElement('DIV');
  actionDiv.setAttribute('aria-label', 'Settings');
  env.document.body.appendChild(actionDiv);
  assert.strictEqual(actionDiv.getAttribute('aria-label'), '设置');
});

it('R2.4: Strictly protects non-translatable attributes (value, id, class, name)', () => {
  const env = createMockEnvironment();
  const engine = createTranslationHarness(env, dicts, regexRules);

  const input = env.document.createElement('INPUT');
  input.setAttribute('value', 'File');
  input.setAttribute('id', 'Save');
  input.setAttribute('class', 'Edit');
  input.setAttribute('name', 'Help');
  env.document.body.appendChild(input);

  assert.strictEqual(input.getAttribute('value'), 'File');
  assert.strictEqual(input.getAttribute('id'), 'Save');
  assert.strictEqual(input.getAttribute('class'), 'Edit');
  assert.strictEqual(input.getAttribute('name'), 'Help');
});

// 5. Code Block & Editor Protection
it('R2.4: Strictly skips <pre><code>let x = 1;</code></pre> code content 100% untouched', () => {
  const env = createMockEnvironment();
  const engine = createTranslationHarness(env, dicts, regexRules);

  const pre = env.document.createElement('PRE');
  const code = env.document.createElement('CODE');
  const sampleCode = 'let x = 1;\nconst File = "Save";\nfunction test() { return "Help"; }';
  code.textContent = sampleCode;
  pre.appendChild(code);
  env.document.body.appendChild(pre);

  assert.strictEqual(code.textContent, sampleCode);
});

it('R2.4: Strictly skips .monaco-editor code tree and inputarea', () => {
  const env = createMockEnvironment();
  const engine = createTranslationHarness(env, dicts, regexRules);

  const monacoContainer = env.document.createElement('DIV');
  monacoContainer.classList.add('monaco-editor');

  const line = env.document.createElement('DIV');
  line.classList.add('view-line');
  const token = env.document.createElement('SPAN');
  token.textContent = 'File';
  line.appendChild(token);
  monacoContainer.appendChild(line);

  // Hidden inputarea inside monaco should have placeholder protected
  const hiddenInput = env.document.createElement('TEXTAREA');
  hiddenInput.classList.add('inputarea');
  hiddenInput.setAttribute('placeholder', 'File');
  monacoContainer.appendChild(hiddenInput);

  env.document.body.appendChild(monacoContainer);

  assert.strictEqual(token.textContent, 'File');
  assert.strictEqual(hiddenInput.getAttribute('placeholder'), 'File');
});

it('R2.4: Strictly skips .cm-editor and contenteditable elements', () => {
  const env = createMockEnvironment();
  const engine = createTranslationHarness(env, dicts, regexRules);

  const cmContainer = env.document.createElement('DIV');
  cmContainer.classList.add('cm-editor');
  const cmLine = env.document.createElement('DIV');
  cmLine.textContent = 'Save';
  cmContainer.appendChild(cmLine);
  env.document.body.appendChild(cmContainer);
  assert.strictEqual(cmLine.textContent, 'Save');

  const editable = env.document.createElement('DIV');
  editable.setAttribute('contenteditable', 'true');
  editable.textContent = 'Settings';
  env.document.body.appendChild(editable);
  assert.strictEqual(editable.textContent, 'Settings');
});

// 6. Loop Prevention & Dual WeakMap Cache
it('R2.5: WeakMap loop prevention maintains reentrancyCount strictly at 0', () => {
  const env = createMockEnvironment();
  const engine = createTranslationHarness(env, dicts, regexRules);

  const span = env.document.createElement('SPAN');
  span.textContent = 'File';
  env.document.body.appendChild(span);

  assert.strictEqual(span.textContent, '文件');
  assert.strictEqual(engine.reentrancyCount, 0);

  // Re-trigger text assignment with translated text
  span.textContent = '文件';
  assert.strictEqual(engine.reentrancyCount, 0);
});

it('R2.5: Supports dynamic reactive text updates without looping', () => {
  const env = createMockEnvironment();
  const engine = createTranslationHarness(env, dicts, regexRules);

  const span = env.document.createElement('SPAN');
  span.textContent = 'Loading...';
  env.document.body.appendChild(span);
  assert.strictEqual(span.textContent, '加载中...');

  span.textContent = 'Settings';
  assert.strictEqual(span.textContent, '设置');
  assert.strictEqual(engine.reentrancyCount, 0);
});

// 7. Shadow DOM Interception (Open and Closed)
it('R2.2: Intercepts open and closed ShadowRoot instances, returning original ShadowRoot', () => {
  const env = createMockEnvironment();
  const engine = createTranslationHarness(env, dicts, regexRules);

  // Open shadow root
  const customElOpen = env.document.createElement('X-AGENT-PANEL');
  env.document.body.appendChild(customElOpen);
  const shadowOpen = customElOpen.attachShadow({ mode: 'open' });
  assert.ok(shadowOpen, 'attachShadow must return ShadowRoot');
  assert.strictEqual(shadowOpen.mode, 'open');

  const openSpan = env.document.createElement('SPAN');
  openSpan.textContent = 'Chat';
  shadowOpen.appendChild(openSpan);
  assert.strictEqual(openSpan.textContent, '对话');

  // Closed shadow root
  const customElClosed = env.document.createElement('X-SETTINGS-CARD');
  env.document.body.appendChild(customElClosed);
  const shadowClosed = customElClosed.attachShadow({ mode: 'closed' });
  assert.ok(shadowClosed, 'attachShadow must return closed ShadowRoot instance to creator');
  assert.strictEqual(shadowClosed.mode, 'closed');

  const closedBtn = env.document.createElement('BUTTON');
  closedBtn.textContent = 'Confirm';
  shadowClosed.appendChild(closedBtn);
  assert.strictEqual(closedBtn.textContent, '确认');
});

// 8. Chinese IME Input Safety
it('R2.3: Chinese IME input session protects Pinyin input and suspends translation', () => {
  const env = createMockEnvironment();
  const engine = createTranslationHarness(env, dicts, regexRules);

  const initialSpan = env.document.createElement('SPAN');
  initialSpan.textContent = 'File';
  env.document.body.appendChild(initialSpan);
  assert.strictEqual(initialSpan.textContent, '文件');
  const countBefore = engine.translationMutationCount;

  // IME starts
  env.window.dispatchEvent({ type: 'compositionstart' });
  assert.strictEqual(engine.isImeComposing, true);

  // Interim keystrokes matching dictionary terms
  const composingSpan = env.document.createElement('SPAN');
  composingSpan.textContent = 'Save';
  env.document.body.appendChild(composingSpan);

  assert.strictEqual(composingSpan.textContent, 'Save', 'Must NOT translate during active composition');
  assert.strictEqual(engine.translationMutationCount, countBefore, 'Zero translation mutations during composition');

  // IME ends
  env.window.dispatchEvent({ type: 'compositionend' });
  assert.strictEqual(engine.isImeComposing, false);

  // Post-composition UI element translated
  const postSpan = env.document.createElement('SPAN');
  postSpan.textContent = 'Help';
  env.document.body.appendChild(postSpan);
  assert.strictEqual(postSpan.textContent, '帮助');
  assert.ok(engine.translationMutationCount > countBefore);
});

// 9. Window Introspection Export
it('R2.6: Window exports window.__ANTIGRAVITY_ZH_ENGINE__ with full introspection API', () => {
  const env = createMockEnvironment();
  const engine = new TranslationEngine({
    window: env.window,
    document: env.document,
    dicts,
    regexRules
  });

  assert.ok(env.window.__ANTIGRAVITY_ZH_ENGINE__);
  assert.strictEqual(env.window.__ANTIGRAVITY_ZH_ENGINE__, engine);
  assert.strictEqual(engine.version, '2.17.0');
  assert.ok(typeof engine.lookupTranslation === 'function');
  assert.ok(typeof engine.translateEntireDocument === 'function');
  assert.ok(typeof engine.isProtected === 'function');
  assert.ok(engine.translatedCache instanceof WeakMap);
  assert.ok(engine.originalCache instanceof WeakMap);
});

// 10. Preload Source Generation & VM Execution
it('R2.6: getInjectedPreloadSource produces executable standalone bundle for dist/preload.js', () => {
  const bundleSource = getInjectedPreloadSource();
  assert.ok(typeof bundleSource === 'string', 'Preload source must be a string');
  assert.ok(bundleSource.includes('__initAntigravityZhEngine__'), 'Must contain initialization function');
  assert.ok(bundleSource.includes('window.__ANTIGRAVITY_ZH_ENGINE__'), 'Must export to window');

  // Execute in isolated VM sandbox with mock DOM environment
  const env = createMockEnvironment();
  const sandbox = {
    window: env.window,
    document: env.document,
    MutationObserver: env.MockMutationObserver,
    Element: env.MockElement,
    Node: env.MockNode,
    console: console,
    Set: Set,
    WeakMap: WeakMap,
    WeakSet: WeakSet,
    RegExp: RegExp,
    JSON: JSON
  };

  vm.createContext(sandbox);
  vm.runInContext(bundleSource, sandbox);

  assert.ok(sandbox.window.__ANTIGRAVITY_ZH_ENGINE__, 'Injected bundle must attach __ANTIGRAVITY_ZH_ENGINE__ to window');

  // Verify runtime translation inside sandbox
  const testSpan = env.document.createElement('SPAN');
  testSpan.textContent = 'File';
  env.document.body.appendChild(testSpan);

  assert.strictEqual(testSpan.textContent, '文件', 'Preload bundle must actively translate DOM');
});

console.log('\n============================================================');
console.log(` Summary: ${passed} passed, ${failed} failed`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
}
