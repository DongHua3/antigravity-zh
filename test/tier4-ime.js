/**
 * Tier 4: IME Composition Simulation Test Suite
 *
 * Verifies:
 * 1. Simulates compositionstart -> DOM mutation -> compositionend lifecycle.
 * 2. Suspends translation during active IME composition to protect Chinese Pinyin
 *    keystrokes, candidate box, and typed characters.
 * 3. Restores translation immediately after compositionend.
 * 4. Ensures zero translation mutations occur while isImeComposing is active.
 * 5. Handles rapid back-to-back composition sessions.
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
 * Runs Tier 4 test suite.
 * @param {TestContext} [t] - Optional test context
 * @returns {TestContext}
 */
function runTier4(t = createTestContext()) {
  const { dicts, regexRules } = loadFixtures();

  t.describe('Tier 4: IME Composition Simulation', () => {
    t.it('Suspends DOM text mutation during active IME composition (compositionstart -> mutation -> compositionend)', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      // 1. Initial state: verify translation works
      const initialSpan = env.document.createElement('SPAN');
      initialSpan.textContent = 'File';
      env.document.body.appendChild(initialSpan);
      t.strictEqual(initialSpan.textContent, '文件', 'Pre-composition translation should work');
      const mutationCountBefore = engine.translationMutationCount;

      // 2. Start IME composition session (user starts typing Pinyin)
      env.window.dispatchEvent({ type: 'compositionstart' });
      t.strictEqual(engine.isImeComposing, true, 'isImeComposing should be true after compositionstart');

      // 3. Simulate interim Pinyin keystroke mutations while composing
      const composingTarget = env.document.createElement('SPAN');
      composingTarget.textContent = 'w';
      env.document.body.appendChild(composingTarget);

      // User types full word matching a dictionary key during interim composition (e.g. "Save" or "File")
      composingTarget.textContent = 'Save';

      // 4. Verify translation is SUSPENDED: content must NOT be altered
      t.strictEqual(
        composingTarget.textContent,
        'Save',
        'Text must remain untouched during active IME composition'
      );
      t.strictEqual(
        engine.translationMutationCount,
        mutationCountBefore,
        'Zero translation mutations should occur during composition'
      );

      // 5. User finishes IME session (commits candidate Chinese text or cancels)
      env.window.dispatchEvent({ type: 'compositionend' });
      t.strictEqual(engine.isImeComposing, false, 'isImeComposing should be false after compositionend');

      // 6. Translation is restored for new post-composition UI elements
      const postSpan = env.document.createElement('SPAN');
      postSpan.textContent = 'Help';
      env.document.body.appendChild(postSpan);

      t.strictEqual(
        postSpan.textContent,
        '帮助',
        'Translation should be immediately restored after compositionend'
      );
      t.assert(
        engine.translationMutationCount > mutationCountBefore,
        'Mutation count should increment after composition resumes'
      );
    });

    t.it('Protects editable input elements from mutation during Pinyin input', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      const chatInput = env.document.createElement('DIV');
      chatInput.setAttribute('contenteditable', 'true');
      env.document.body.appendChild(chatInput);

      // Begin composition
      env.window.dispatchEvent({ type: 'compositionstart' });

      // Simulate character data stream: "n" -> "ni" -> "nih" -> "niha" -> "nihao"
      const interimText = env.document.createTextNode('nihao');
      chatInput.appendChild(interimText);

      t.strictEqual(
        chatInput.textContent,
        'nihao',
        'Pinyin buffer must remain intact without engine interference'
      );

      // End composition
      env.window.dispatchEvent({ type: 'compositionend' });

      // User committed text
      interimText.textContent = '你好';
      t.strictEqual(chatInput.textContent, '你好', 'Committed Chinese text remains intact');
    });

    t.it('Handles rapid back-to-back IME composition sessions cleanly', () => {
      const env = createMockEnvironment();
      const engine = createTranslationHarness(env, dicts, regexRules);

      // Session 1: Cancelled
      env.window.dispatchEvent({ type: 'compositionstart' });
      t.strictEqual(engine.isImeComposing, true);
      env.window.dispatchEvent({ type: 'compositionend' });
      t.strictEqual(engine.isImeComposing, false);

      // Session 2: Immediate new typing
      env.window.dispatchEvent({ type: 'compositionstart' });
      t.strictEqual(engine.isImeComposing, true);

      const span = env.document.createElement('SPAN');
      span.textContent = 'Edit';
      env.document.body.appendChild(span);
      t.strictEqual(span.textContent, 'Edit', 'Must remain untranslated in second session');

      env.window.dispatchEvent({ type: 'compositionend' });
      t.strictEqual(engine.isImeComposing, false);

      // New element translated
      const span2 = env.document.createElement('SPAN');
      span2.textContent = 'Edit';
      env.document.body.appendChild(span2);
      t.strictEqual(span2.textContent, '编辑', 'Translation works after second session ends');
    });
  });

  return t;
}

if (require.main === module) {
  const t = runTier4();
  t.printSummary('Tier 4: IME Composition Simulation');
  process.exit(t.failedCount > 0 ? 1 : 0);
}

module.exports = {
  runTier4
};
