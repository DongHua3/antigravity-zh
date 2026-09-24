/**
 * Tier 3: DOM Translation & Code Skipping Simulation Test Suite
 *
 * Verifies:
 * 1. Translation of plain text nodes using dictionary terms.
 * 2. Attribute translation (placeholder, title, aria-label) while strictly leaving
 *    non-translatable attributes (value, id, class, name) untouched.
 * 3. Strict skipping of code elements and editors:
 *    - <pre> and <code> (e.g. `<pre><code>let x = 1;</code></pre>` must remain 100% untouched).
 *    - .monaco-editor and .cm-editor
 *    - [contenteditable="true"] and [contenteditable="plaintext-only"]
 *    - <textarea> and editor inputs
 * 4. WeakMap cache & loop re-entrancy prevention (re-entrancy count is 0).
 * 5. Web Components / Shadow DOM translation (open and closed roots).
 */

const fs = require('fs');
const path = require('path');
const { createTestContext } = require('./helpers/assert');
const { createMockEnvironment } = require('./helpers/mock-dom');
const { createTranslationHarness } = require('./helpers/runtime-harness');

function loadFixtures() {
  const dictsDir = path.join(__dirname, 'fixtures', 'dicts');
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

/**
 * Runs Tier 3 test suite.
 * @param {TestContext} [t] - Optional test context
 * @returns {TestContext}
 */
function runTier3(t = createTestContext()) {
  const { dicts, regexRules } = loadFixtures();

  t.describe('Tier 3: DOM Translation & Code Skipping Simulation', () => {
    // 1. Plain Text Translation
    t.it('Translates plain text nodes using dictionary terms', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const span = env.document.createElement('SPAN');
      span.textContent = 'File';
      env.document.body.appendChild(span);

      t.strictEqual(span.textContent, '文件', 'Plain text "File" should be translated to "文件"');

      const btn = env.document.createElement('BUTTON');
      btn.textContent = 'Save';
      env.document.body.appendChild(btn);

      t.strictEqual(btn.textContent, '保存', 'Button text "Save" should be translated to "保存"');
    });

    t.it('Translates dynamic strings using regex rules', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const div = env.document.createElement('DIV');
      div.textContent = '3 agents running';
      env.document.body.appendChild(div);

      t.strictEqual(div.textContent, '3 个正在运行的智能体', 'Dynamic regex text should be translated with interpolation');
    });

    // 2. Attribute Translation
    t.it('Translates UI attributes (placeholder, title, aria-label)', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const input = env.document.createElement('INPUT');
      input.setAttribute('placeholder', 'Ask Antigravity...');
      env.document.body.appendChild(input);

      t.strictEqual(
        input.getAttribute('placeholder'),
        '向 Antigravity 提问...',
        'Placeholder attribute should be translated'
      );

      const closeBtn = env.document.createElement('BUTTON');
      closeBtn.setAttribute('title', 'Close');
      env.document.body.appendChild(closeBtn);

      t.strictEqual(closeBtn.getAttribute('title'), '关闭', 'Title attribute should be translated');

      const actionDiv = env.document.createElement('DIV');
      actionDiv.setAttribute('aria-label', 'Settings');
      env.document.body.appendChild(actionDiv);

      t.strictEqual(actionDiv.getAttribute('aria-label'), '设置', 'Aria-label attribute should be translated');
    });

    t.it('Strictly protects non-translatable attributes (value, id, class, name)', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const input = env.document.createElement('INPUT');
      input.setAttribute('value', 'File');
      input.setAttribute('id', 'Save');
      input.setAttribute('class', 'Edit');
      input.setAttribute('name', 'Help');
      env.document.body.appendChild(input);

      t.strictEqual(input.getAttribute('value'), 'File', 'Value attribute must remain strictly untouched');
      t.strictEqual(input.getAttribute('id'), 'Save', 'Id attribute must remain strictly untouched');
      t.strictEqual(input.getAttribute('class'), 'Edit', 'Class attribute must remain strictly untouched');
      t.strictEqual(input.getAttribute('name'), 'Help', 'Name attribute must remain strictly untouched');
    });

    // 3. Strict Code & Editor Skipping
    t.it('Strictly skips code elements (<pre><code>let x = 1;</code></pre> 100% untouched)', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const pre = env.document.createElement('PRE');
      const code = env.document.createElement('CODE');
      const sampleCode = 'let x = 1;\nconst File = "Save";\nfunction test() { return "Help"; }';
      code.textContent = sampleCode;
      pre.appendChild(code);
      env.document.body.appendChild(pre);

      t.strictEqual(code.textContent, sampleCode, 'Code content inside <pre><code> must remain 100% untouched');
    });

    t.it('Strictly skips Monaco editor (.monaco-editor) code tree', () => {
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
      env.document.body.appendChild(monacoContainer);

      t.strictEqual(token.textContent, 'File', 'Tokens inside .monaco-editor must remain untouched');
    });

    t.it('Strictly skips CodeMirror editor (.cm-editor) and contenteditable', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const cmContainer = env.document.createElement('DIV');
      cmContainer.classList.add('cm-editor');
      const cmLine = env.document.createElement('DIV');
      cmLine.textContent = 'Save';
      cmContainer.appendChild(cmLine);
      env.document.body.appendChild(cmContainer);

      t.strictEqual(cmLine.textContent, 'Save', 'Tokens inside .cm-editor must remain untouched');

      const editable = env.document.createElement('DIV');
      editable.setAttribute('contenteditable', 'true');
      editable.textContent = 'Settings';
      env.document.body.appendChild(editable);

      t.strictEqual(editable.textContent, 'Settings', 'Contenteditable elements must remain untouched');
    });

    // 4. WeakMap Cache & Loop Prevention
    t.it('WeakMap cache loop prevention test (re-entrancy count is strictly 0)', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const span = env.document.createElement('SPAN');
      span.textContent = 'File';
      env.document.body.appendChild(span);

      t.strictEqual(span.textContent, '文件');
      t.strictEqual(engine.reentrancyCount, 0, 'Re-entrancy count must be strictly 0');

      // Re-trigger characterData on already translated node
      span.textContent = '文件';
      t.strictEqual(engine.reentrancyCount, 0, 'Re-entrancy count must remain 0 after duplicate assignment');
    });

    t.it('Supports dynamic reactive text updates without looping', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const span = env.document.createElement('SPAN');
      span.textContent = 'Loading...';
      env.document.body.appendChild(span);

      t.strictEqual(span.textContent, '加载中...');

      // Dynamic update to a new state
      span.textContent = 'Settings';
      t.strictEqual(span.textContent, '设置', 'External text update should be recognized and translated');
      t.strictEqual(engine.reentrancyCount, 0, 'No loop recursion on reactive update');
    });

    // 5. Web Components / Shadow DOM
    t.it('Intercepts Element.prototype.attachShadow and translates inside shadow roots', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const customEl = env.document.createElement('X-AGENT-PANEL');
      env.document.body.appendChild(customEl);

      const shadow = customEl.attachShadow({ mode: 'open' });
      const shadowSpan = env.document.createElement('SPAN');
      shadowSpan.textContent = 'Chat';
      shadow.appendChild(shadowSpan);

      t.strictEqual(shadowSpan.textContent, '对话', 'Text inside shadow DOM must be translated');
    });

    t.it('Intercepts closed shadow roots and translates text seamlessly', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const customEl = env.document.createElement('X-SETTINGS-CARD');
      env.document.body.appendChild(customEl);

      const closedShadow = customEl.attachShadow({ mode: 'closed' });
      const shadowBtn = env.document.createElement('BUTTON');
      shadowBtn.textContent = 'Confirm';
      closedShadow.appendChild(shadowBtn);

      t.strictEqual(shadowBtn.textContent, '确认', 'Text inside closed shadow root must be translated');
    });

    t.it('Strictly protects code elements even when nested inside ShadowRoot', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const editorHost = env.document.createElement('DIV');
      editorHost.className = 'monaco-editor';
      env.document.body.appendChild(editorHost);

      const shadow = editorHost.attachShadow({ mode: 'open' });
      const codeSpan = env.document.createElement('SPAN');
      codeSpan.textContent = 'Save';
      shadow.appendChild(codeSpan);

      t.strictEqual(codeSpan.textContent, 'Save', 'Code content inside Monaco shadow root must remain untouched');
    });

    t.it('Translates elements with keyboard shortcut suffixes (translateWithShortcut)', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const btn = env.document.createElement('BUTTON');
      btn.textContent = 'File (Ctrl+F)';
      env.document.body.appendChild(btn);

      t.strictEqual(btn.textContent, '文件 (Ctrl+F)', 'Shortcut suffix should be preserved while label is translated');
    });

    t.it('Protects syntax tokens, diffEditor, and pack.info skeleton elements', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const diffLine = env.document.createElement('DIV');
      diffLine.className = 'code-line diffEditor';
      diffLine.textContent = 'Save';
      env.document.body.appendChild(diffLine);

      t.strictEqual(diffLine.textContent, 'Save', 'Code line inside diffEditor must remain untouched');

      const skel = env.document.createElement('DIV');
      skel.textContent = 'pack.info loading';
      env.document.body.appendChild(skel);

      t.strictEqual(skel.getAttribute('translate'), 'no', 'Skeleton loader must have translate="no" set');
    });

    t.it('Normalizes multi-line text nodes and typographic smart quotes', () => {
      const env = createMockEnvironment();
      const customDicts = {
        ...dicts,
        common: {
          ...dicts.common,
          "Don't show this again": "不再显示此提示",
          "Configure settings for the current workspace": "配置当前工作区的设置"
        }
      };
      const engine = createTranslationHarness(env, customDicts, regexRules);

      // Multiline text node
      const el1 = env.document.createElement('P');
      el1.textContent = '\n  Configure settings for\n  the current workspace\n';
      env.document.body.appendChild(el1);
      t.strictEqual(el1.textContent.trim(), '配置当前工作区的设置', 'Must normalize multi-line whitespace and translate');

      // Typographic curly apostrophe (’ vs ')
      const el2 = env.document.createElement('SPAN');
      el2.textContent = 'Don’t show this again';
      env.document.body.appendChild(el2);
      t.strictEqual(el2.textContent, '不再显示此提示', 'Must normalize curly apostrophe and translate');
    });

    t.it('Performs 18-character prefix matching on long setting descriptions', () => {
      const env = createMockEnvironment();
      const customDicts = {
        ...dicts,
        settings: {
          ...dicts.settings,
          "Allow the agent to view and edit files in the workspace": "允许智能体查看和编辑工作区内的文件"
        }
      };
      const engine = createTranslationHarness(env, customDicts, regexRules);

      // Altered trailing phrasing (where key is not a substring, but shares >= 18 char prefix)
      const el = env.document.createElement('P');
      el.textContent = 'Allow the agent to view and modify files in the repository.';
      env.document.body.appendChild(el);
      t.strictEqual(el.textContent, '允许智能体查看和编辑工作区内的文件', 'Must match on 18-char prefix and translate');
    });
  });

  return t;
}

if (require.main === module) {
  const t = runTier3();
  t.printSummary('Tier 3: DOM Translation & Code Skipping Simulation');
  process.exit(t.failedCount > 0 ? 1 : 0);
}

module.exports = {
  runTier3
};
