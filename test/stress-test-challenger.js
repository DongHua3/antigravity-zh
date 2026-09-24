'use strict';

/**
 * test/stress-test-challenger.js
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST HARNESS for Runtime DOM Translation Engine (lib/runtime/engine.js)
 * Executed by Challenger Agent (challenger_2)
 *
 * Verifies:
 * 1. High-frequency DOM mutation stress (2,000+ mutations, re-entrancy, memory leaks, mutex lock)
 * 2. Deeply nested Shadow DOM (depth 6+, mixed open/closed, encapsulation, localization)
 * 3. IME Edge Cases (interrupted composition, Escape, blur, rapid typing, zero text corruption)
 * 4. Code block and keyword collision (<pre><code>, .monaco-editor, .cm-editor, 100% byte fidelity)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { TranslationEngine, loadDefaultDictionaries } = require('../lib/runtime/engine');
const { createMockEnvironment } = require('./helpers/mock-dom');

const results = {
  suite1_mutations: { passed: 0, failed: 0, details: [] },
  suite2_shadow_dom: { passed: 0, failed: 0, details: [] },
  suite3_ime: { passed: 0, failed: 0, details: [] },
  suite4_code_blocks: { passed: 0, failed: 0, details: [] },
  bugs_found: []
};

function record(suite, name, passed, info) {
  results[suite].details.push({ name, passed, info });
  if (passed) {
    results[suite].passed++;
    console.log(`  \x1b[32m✔ PASS\x1b[0m [${suite}] ${name}`);
  } else {
    results[suite].failed++;
    console.log(`  \x1b[31m✘ FAIL\x1b[0m [${suite}] ${name}`);
    if (info) console.log(`     \x1b[33m${info}\x1b[0m`);
  }
}

const defaultDicts = loadDefaultDictionaries();

console.log('\n============================================================');
console.log(' ADVERSARIAL STRESS TEST SUITE: lib/runtime/engine.js');
console.log(' Challenger Agent: challenger_2');
console.log('============================================================\n');

// ============================================================
// SUITE 1: High-Frequency DOM Mutation & Mutex Stress Test
// ============================================================
console.log('>>> [Suite 1] High-Frequency DOM Mutation & Mutex Stress Test');

(function testHighFrequencyMutations() {
  const env = createMockEnvironment();
  const engine = new TranslationEngine({
    window: env.window,
    document: env.document,
    dicts: defaultDicts
  });

  const count = 2000;
  const nodes = [];

  // 1.1 Rapid childList insertions (2,000 nodes)
  const startTime = Date.now();
  for (let i = 0; i < count; i++) {
    const span = env.document.createElement('SPAN');
    span.textContent = i % 2 === 0 ? 'Save' : 'Cancel';
    env.document.body.appendChild(span);
    nodes.push(span);
  }
  const insertDuration = Date.now() - startTime;

  const reentrancyAfterInsert = engine.reentrancyCount;
  const isMutatingAfterInsert = engine.isMutatingDom;
  const mutationsCountAfterInsert = engine.translationMutationCount;

  record(
    'suite1_mutations',
    `1.1 Flood DOM with ${count} rapid node insertions (took ${insertDuration}ms)`,
    reentrancyAfterInsert === 0 && !isMutatingAfterInsert && mutationsCountAfterInsert === count,
    `reentrancy=${reentrancyAfterInsert}, isMutatingDom=${isMutatingAfterInsert}, mutations=${mutationsCountAfterInsert}/${count}`
  );

  // 1.2 Rapid characterData mutations (2,000 updates)
  const updateStartTime = Date.now();
  for (let i = 0; i < count; i++) {
    nodes[i].textContent = i % 2 === 0 ? 'File' : 'Edit';
  }
  const updateDuration = Date.now() - updateStartTime;

  const reentrancyAfterUpdate = engine.reentrancyCount;
  const isMutatingAfterUpdate = engine.isMutatingDom;
  const mutationsCountAfterUpdate = engine.translationMutationCount;

  record(
    'suite1_mutations',
    `1.2 Rapid textContent mutation on ${count} nodes (took ${updateDuration}ms)`,
    reentrancyAfterUpdate === 0 && !isMutatingAfterUpdate && mutationsCountAfterUpdate === count * 2,
    `reentrancy=${reentrancyAfterUpdate}, isMutatingDom=${isMutatingAfterUpdate}, totalMutations=${mutationsCountAfterUpdate}`
  );

  // 1.3 Mutex lock re-entrancy protection
  engine.isMutatingDom = true;
  const initialReentrancy = engine.reentrancyCount;
  const testNode = env.document.createElement('SPAN');
  testNode.textContent = 'Save';
  engine.processTextNode(testNode);
  engine.isMutatingDom = false;

  const reentrancyCaught = engine.reentrancyCount > initialReentrancy;
  record(
    'suite1_mutations',
    '1.3 Mutex lock blocks re-entrant processTextNode and increments reentrancyCount',
    reentrancyCaught && testNode.textContent === 'Save',
    `reentrancyCount incremented to ${engine.reentrancyCount}, text preserved as 'Save'`
  );

  // 1.4 Memory Leak: ShadowRoot MutationObserver unbounded retention
  const initialObserversCount = engine.activeObservers.length;
  const shadowCount = 1500;
  for (let i = 0; i < shadowCount; i++) {
    const host = env.document.createElement('DIV');
    env.document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const s = env.document.createElement('SPAN');
    s.textContent = 'Save';
    shadow.appendChild(s);
    env.document.body.removeChild(host);
  }

  const finalObserversCount = engine.activeObservers.length;
  const hasObserverLeak = finalObserversCount >= shadowCount;
  if (hasObserverLeak) {
    results.bugs_found.push({
      id: 'BUG-MEM-01',
      severity: 'MEDIUM',
      title: 'Unbounded MutationObserver array growth on ShadowRoot lifecycle',
      description: `Creating and unmounting ${shadowCount} ShadowRoots caused engine.activeObservers to grow from ${initialObserversCount} to ${finalObserversCount} without pruning disconnected observers.`
    });
  }

  record(
    'suite1_mutations',
    `1.4 Memory Leak check: engine.activeObservers pruning on ShadowRoot removal`,
    !hasObserverLeak,
    `engine.activeObservers grew from ${initialObserversCount} to ${finalObserversCount} (retained all ${shadowCount} dead observers)`
  );
})();

// ============================================================
// SUITE 2: Deeply Nested Shadow DOM Test
// ============================================================
console.log('\n>>> [Suite 2] Deeply Nested Shadow DOM Test');

(function testDeeplyNestedShadowDom() {
  const env = createMockEnvironment();
  const engine = new TranslationEngine({
    window: env.window,
    document: env.document,
    dicts: defaultDicts
  });

  const levels = [
    { tag: 'WC-LEVEL-1', mode: 'open', text: 'Save', expected: '保存' },
    { tag: 'WC-LEVEL-2', mode: 'closed', text: 'Confirm', expected: '确认' },
    { tag: 'WC-LEVEL-3', mode: 'open', text: 'File', expected: '文件' },
    { tag: 'WC-LEVEL-4', mode: 'closed', text: 'Edit', expected: '编辑' },
    { tag: 'WC-LEVEL-5', mode: 'open', text: 'Close', expected: '关闭' },
    { tag: 'WC-LEVEL-6', mode: 'closed', text: 'Help', expected: '帮助' }
  ];

  let currentContainer = env.document.body;
  const elements = [];
  const roots = [];
  let encapsulationIntact = true;

  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const el = env.document.createElement(lvl.tag);
    currentContainer.appendChild(el);
    elements.push(el);

    const shadow = el.attachShadow({ mode: lvl.mode });
    roots.push(shadow);

    const span = env.document.createElement('SPAN');
    span.textContent = lvl.text;
    shadow.appendChild(span);

    // Verify encapsulation
    if (lvl.mode === 'closed') {
      if (el.shadowRoot !== null) {
        encapsulationIntact = false;
      }
    } else {
      if (el.shadowRoot !== shadow) {
        encapsulationIntact = false;
      }
    }

    currentContainer = shadow;
  }

  record(
    'suite2_shadow_dom',
    '2.1 Web Component encapsulation intact across depth-6 hierarchy (closed roots return null, open roots accessible)',
    encapsulationIntact,
    encapsulationIntact ? 'All open and closed shadowRoot properties conform strictly to DOM spec' : 'Encapsulation violated'
  );

  let allLevelsTranslated = true;
  const translationDetails = [];
  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const span = roots[i].childNodes[0];
    const actual = span.textContent;
    const ok = actual === lvl.expected;
    translationDetails.push(`L${i + 1}(${lvl.mode}): ${actual}`);
    if (!ok) allLevelsTranslated = false;
  }

  record(
    'suite2_shadow_dom',
    '2.2 Shadow boundary traversal translates all 6 nested levels accurately',
    allLevelsTranslated,
    translationDetails.join(', ')
  );

  // 2.3 Detached nested hierarchy
  const detachedHost = env.document.createElement('WC-DETACHED-HOST');
  const detachedShadow = detachedHost.attachShadow({ mode: 'open' });
  const detachedInnerHost = env.document.createElement('WC-DETACHED-INNER');
  detachedShadow.appendChild(detachedInnerHost);
  const detachedInnerShadow = detachedInnerHost.attachShadow({ mode: 'closed' });
  const detachedSpan = env.document.createElement('SPAN');
  detachedSpan.textContent = 'Save';
  detachedInnerShadow.appendChild(detachedSpan);

  // Append detached tree to DOM
  env.document.body.appendChild(detachedHost);

  record(
    'suite2_shadow_dom',
    '2.3 Off-DOM detached nested Shadow DOM translation upon attachment',
    detachedSpan.textContent === '保存',
    `Span text inside nested closed shadow: '${detachedSpan.textContent}'`
  );
})();

// ============================================================
// SUITE 3: IME Edge Cases & Composition Stress Test
// ============================================================
console.log('\n>>> [Suite 3] IME Edge Cases & Composition Stress Test');

(function testImeEdgeCases() {
  const env = createMockEnvironment();
  const engine = new TranslationEngine({
    window: env.window,
    document: env.document,
    dicts: defaultDicts
  });

  // 3.1 Normal IME session: compositionstart -> text changes -> compositionend
  env.window.dispatchEvent({ type: 'compositionstart' });
  const isComposingStart = engine.isImeComposing === true;

  // Intermediate typing
  const composingSpan = env.document.createElement('SPAN');
  composingSpan.textContent = 'Save';
  env.document.body.appendChild(composingSpan);
  const textUntouchedDuringIme = composingSpan.textContent === 'Save';

  env.window.dispatchEvent({ type: 'compositionend' });
  const isComposingEnd = engine.isImeComposing === false;

  record(
    'suite3_ime',
    '3.1 Standard IME session suspends translation during active composition',
    isComposingStart && textUntouchedDuringIme && isComposingEnd,
    `startComposing=${isComposingStart}, textProtected=${textUntouchedDuringIme}, endComposing=${isComposingEnd}`
  );

  // 3.2 Interrupted composition via Escape key
  env.window.dispatchEvent({ type: 'compositionstart' });
  assert.strictEqual(engine.isImeComposing, true);

  // User hits Escape to abort composition (no compositionend event fired)
  env.window.dispatchEvent({ type: 'keydown', key: 'Escape', keyCode: 27 });

  // Post-abort UI element arrives
  const postEscapeSpan = env.document.createElement('SPAN');
  postEscapeSpan.textContent = 'File';
  env.document.body.appendChild(postEscapeSpan);

  const escapeHandled = engine.isImeComposing === false && postEscapeSpan.textContent === '文件';
  if (!escapeHandled) {
    results.bugs_found.push({
      id: 'BUG-IME-01',
      severity: 'HIGH',
      title: 'Interrupted IME composition via Escape key permanently freezes DOM translation',
      description: 'When IME composition is cancelled via Escape key without a compositionend event, engine.isImeComposing remains true indefinitely, permanently suspending all subsequent DOM translations in the application.'
    });
  }

  record(
    'suite3_ime',
    '3.2 Interrupted composition via Escape key resets isImeComposing and resumes translations',
    escapeHandled,
    `engine.isImeComposing=${engine.isImeComposing}, postEscapeSpan.textContent='${postEscapeSpan.textContent}' (expected '文件')`
  );

  // Reset engine state for next subtest if stuck
  engine.isImeComposing = false;

  // 3.3 Interrupted composition via blur
  env.window.dispatchEvent({ type: 'compositionstart' });
  assert.strictEqual(engine.isImeComposing, true);

  // Input loses focus (user clicks away, blur event dispatched)
  env.window.dispatchEvent({ type: 'blur' });

  const postBlurSpan = env.document.createElement('SPAN');
  postBlurSpan.textContent = 'Cancel';
  env.document.body.appendChild(postBlurSpan);

  const blurHandled = engine.isImeComposing === false && postBlurSpan.textContent === '取消';
  if (!blurHandled) {
    results.bugs_found.push({
      id: 'BUG-IME-02',
      severity: 'HIGH',
      title: 'Interrupted IME composition via blur permanently freezes DOM translation',
      description: 'When an input element blurs during active composition without a compositionend event, engine.isImeComposing remains true indefinitely, blocking all future translations.'
    });
  }

  record(
    'suite3_ime',
    '3.3 Interrupted composition via blur resets isImeComposing and resumes translations',
    blurHandled,
    `engine.isImeComposing=${engine.isImeComposing}, postBlurSpan.textContent='${postBlurSpan.textContent}' (expected '取消')`
  );

  // Reset engine state if stuck
  engine.isImeComposing = false;

  // 3.4 Protected inputs & editable elements never corrupted
  const inputEl = env.document.createElement('INPUT');
  inputEl.setAttribute('value', 'Save');
  inputEl.setAttribute('placeholder', 'Save');
  env.document.body.appendChild(inputEl);

  const ceEl = env.document.createElement('DIV');
  ceEl.setAttribute('contenteditable', 'true');
  ceEl.textContent = 'let save = 1;';
  env.document.body.appendChild(ceEl);

  record(
    'suite3_ime',
    '3.4 Input value and contenteditable text preserved without corruption',
    inputEl.getAttribute('value') === 'Save' &&
    inputEl.getAttribute('placeholder') === '保存' &&
    ceEl.textContent === 'let save = 1;',
    `input.value='${inputEl.getAttribute('value')}', input.placeholder='${inputEl.getAttribute('placeholder')}', ce.text='${ceEl.textContent}'`
  );
})();

// ============================================================
// SUITE 4: Code Block & Keyword Collision Test
// ============================================================
console.log('\n>>> [Suite 4] Code Block & Keyword Collision Test');

(function testCodeBlocksAndKeywordCollision() {
  const env = createMockEnvironment();
  const engine = new TranslationEngine({
    window: env.window,
    document: env.document,
    dicts: defaultDicts
  });

  const sampleSnippet = 'let save = true;\nfunction cancel() {\n  const file = open("test.txt");\n  if (file) file.close();\n}';

  // 4.1 Static <pre><code> block appended all at once
  const preStatic = env.document.createElement('PRE');
  const codeStatic = env.document.createElement('CODE');
  codeStatic.textContent = sampleSnippet;
  preStatic.appendChild(codeStatic);
  env.document.body.appendChild(preStatic);

  const staticPass = codeStatic.textContent === sampleSnippet;
  record(
    'suite4_code_blocks',
    '4.1 Static <pre><code> block preserving 100% byte fidelity when appended at once',
    staticPass,
    staticPass ? '100% byte equality maintained' : `Mismatch: '${codeStatic.textContent}'`
  );

  // 4.2 Dynamic syntax highlighting inside <pre><code> (streaming or highlighter tokens)
  const preDynamic = env.document.createElement('PRE');
  const codeDynamic = env.document.createElement('CODE');
  preDynamic.appendChild(codeDynamic);
  env.document.body.appendChild(preDynamic);

  // Syntax highlighter appends token spans matching dictionary entries
  const tokens = [
    { cls: 'token keyword', text: 'let ' },
    { cls: 'token variable', text: 'Save' },
    { cls: 'token operator', text: ' = ' },
    { cls: 'token boolean', text: 'true' },
    { cls: 'token punctuation', text: ';\n' },
    { cls: 'token keyword', text: 'function ' },
    { cls: 'token function', text: 'Cancel' },
    { cls: 'token punctuation', text: '() {}' }
  ];

  for (const t of tokens) {
    const s = env.document.createElement('SPAN');
    s.className = t.cls;
    s.textContent = t.text;
    codeDynamic.appendChild(s);
  }

  const expectedCode = 'let Save = true;\nfunction Cancel() {}';
  const actualCode = codeDynamic.textContent;
  const dynamicPass = actualCode === expectedCode;

  if (!dynamicPass) {
    results.bugs_found.push({
      id: 'BUG-CODE-01',
      severity: 'CRITICAL',
      title: 'Code corruption in syntax-highlighted / dynamic spans inside <pre><code>',
      description: `Dynamic <span> child elements appended inside <pre><code> are not matched by PROTECTED_SELECTORS (which only lists editors, not 'pre' or 'code'). Consequently, code tokens matching dictionary entries (e.g. 'save' -> '保存', 'cancel' -> '取消') are corrupted. Actual rendered code: '${actualCode}'. Expected: '${expectedCode}'.`
    });
  }

  record(
    'suite4_code_blocks',
    '4.2 Dynamic syntax-highlighted spans inside <pre><code> preserve 100% byte fidelity',
    dynamicPass,
    `Actual: '${actualCode}' vs Expected: '${expectedCode}'`
  );

  // 4.3 Monaco Editor (.monaco-editor) code tree protection
  const monaco = env.document.createElement('DIV');
  monaco.className = 'monaco-editor';
  const line1 = env.document.createElement('DIV');
  line1.className = 'view-line';
  const mSpan1 = env.document.createElement('SPAN');
  mSpan1.textContent = 'let save = true;';
  line1.appendChild(mSpan1);
  monaco.appendChild(line1);

  const line2 = env.document.createElement('DIV');
  line2.className = 'view-line';
  const mSpan2 = env.document.createElement('SPAN');
  mSpan2.textContent = 'function cancel() {}';
  line2.appendChild(mSpan2);
  monaco.appendChild(line2);

  env.document.body.appendChild(monaco);

  const monacoPass = mSpan1.textContent === 'let save = true;' && mSpan2.textContent === 'function cancel() {}';
  record(
    'suite4_code_blocks',
    '4.3 Monaco Editor (.monaco-editor) code lines preserve 100% byte fidelity',
    monacoPass,
    monacoPass ? 'All tokens in monaco-editor untouched' : 'Monaco code corrupted'
  );

  // 4.4 CodeMirror Editor (.cm-editor) protection
  const cm = env.document.createElement('DIV');
  cm.className = 'cm-editor';
  const cmContent = env.document.createElement('DIV');
  cmContent.className = 'cm-content';
  const cmLine = env.document.createElement('DIV');
  cmLine.className = 'cm-line';
  const cmSpan = env.document.createElement('SPAN');
  cmSpan.textContent = 'save; cancel; close; open;';
  cmLine.appendChild(cmSpan);
  cmContent.appendChild(cmLine);
  cm.appendChild(cmContent);
  env.document.body.appendChild(cm);

  const cmPass = cmSpan.textContent === 'save; cancel; close; open;';
  record(
    'suite4_code_blocks',
    '4.4 CodeMirror Editor (.cm-editor) code lines preserve 100% byte fidelity',
    cmPass,
    cmPass ? 'All tokens in cm-editor untouched' : 'CodeMirror code corrupted'
  );

  // 4.5 Streaming tokens appended into <pre><code>
  const preStream = env.document.createElement('PRE');
  const codeStream = env.document.createElement('CODE');
  preStream.appendChild(codeStream);
  env.document.body.appendChild(preStream);

  const streamingTokens = ['File', 'Edit', 'View', 'Run', 'Terminal', 'Help'];
  for (const tok of streamingTokens) {
    const s = env.document.createElement('SPAN');
    s.textContent = tok;
    codeStream.appendChild(s);
  }

  const streamActual = codeStream.textContent;
  const streamExpected = streamingTokens.join('');
  const streamPass = streamActual === streamExpected;

  record(
    'suite4_code_blocks',
    '4.5 Streaming tokens matching UI menu items inside <pre><code> preserved untouched',
    streamPass,
    `Actual: '${streamActual}' vs Expected: '${streamExpected}'`
  );
})();

// ============================================================
// SUMMARY & VERDICT
// ============================================================
console.log('\n============================================================');
console.log(' ADVERSARIAL STRESS TEST SUMMARY');
console.log('============================================================');

let totalPassed = 0;
let totalFailed = 0;

for (const [suiteKey, suiteData] of Object.entries(results)) {
  if (suiteKey === 'bugs_found') continue;
  console.log(`  ${suiteKey}: ${suiteData.passed} passed, ${suiteData.failed} failed`);
  totalPassed += suiteData.passed;
  totalFailed += suiteData.failed;
}

console.log(`\n  Total Passed: ${totalPassed}`);
console.log(`  Total Failed: ${totalFailed}`);

if (results.bugs_found.length > 0) {
  console.log(`\n\x1b[31m  Confirmed Bugs / Vulnerabilities (${results.bugs_found.length}):\x1b[0m`);
  results.bugs_found.forEach((b, idx) => {
    console.log(`  [${idx + 1}] [${b.severity}] ${b.id}: ${b.title}`);
    console.log(`      ${b.description}`);
  });
}

console.log('============================================================');
const verdict = totalFailed === 0 ? 'APPROVE' : 'REQUEST_CHANGES';
console.log(`  FINAL VERDICT: \x1b[${verdict === 'APPROVE' ? '32' : '31'}m${verdict}\x1b[0m`);
console.log('============================================================\n');

// Write out JSON results for reporting
fs.writeFileSync(
  path.join(__dirname, '..', '..', '.agents', 'teamwork', 'challenger_2', 'stress-results.json'),
  JSON.stringify(results, null, 2),
  'utf8'
);

process.exit(totalFailed > 0 ? 1 : 0);
