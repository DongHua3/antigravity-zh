'use strict';

/**
 * lib/patches/wizardHtml.js
 *
 * Statically patches dist/ideInstall/wizardHtml.js in Google Antigravity:
 * Localizes standalone HTML template strings rendered in the IDE Install Wizard modal BrowserWindow:
 * - <title>Welcome to Antigravity</title> -> <title>欢迎使用 Antigravity</title>
 * - Setting up… -> 正在配置…
 * - <h1>Welcome to the new Antigravity!</h1> -> <h1>欢迎体验全新 Antigravity！</h1>
 * - Description paragraph -> Chinese description
 * - <span>Download the Antigravity IDE</span> -> <span>下载 Antigravity IDE</span>
 * - <button class="btn-primary" id="btn-skip">Explore the new Antigravity</button> -> <button class="btn-primary" id="btn-skip">开始探索 Antigravity</button>
 */

const REPLACEMENTS = [
  {
    pattern: /<title>Welcome to Antigravity<\/title>/g,
    replacement: '<title>欢迎使用 Antigravity</title>'
  },
  {
    pattern: /(<div class="text"[^>]*>)Setting up(?:…|\.{3})(<\/div>)/g,
    replacement: '$1正在配置…$2'
  },
  {
    pattern: /<h1>Welcome to the new Antigravity!<\/h1>/g,
    replacement: '<h1>欢迎体验全新 Antigravity！</h1>'
  },
  {
    pattern: /<p>Antigravity has been redesigned to put agents first with new capabilities\. If you'd still like a code editor, you can download it as a separate app named <b>Antigravity IDE<\/b>\.<\/p>/g,
    replacement: '<p>Antigravity 经过全新设计，以智能体为核心并带来强大新能力。如果您仍需要代码编辑器，可下载独立的 <b>Antigravity IDE</b> 应用程序。</p>'
  },
  {
    pattern: /<span>Download the Antigravity IDE<\/span>/g,
    replacement: '<span>下载 Antigravity IDE</span>'
  },
  {
    pattern: /(<button[^>]*id="btn-skip"[^>]*>)Explore the new Antigravity(<\/button>)/g,
    replacement: '$1开始探索 Antigravity$2'
  }
];

/**
 * Patches the source code of dist/ideInstall/wizardHtml.js.
 * @param {string} sourceCode
 * @returns {string} Patched source code
 */
function patchWizardHtml(sourceCode) {
  if (typeof sourceCode !== 'string') {
    throw new TypeError('patchWizardHtml requires a string argument');
  }

  let patched = sourceCode;

  for (const item of REPLACEMENTS) {
    patched = patched.replace(item.pattern, item.replacement);
  }

  return patched;
}

module.exports = {
  patchWizardHtml,
  REPLACEMENTS
};
