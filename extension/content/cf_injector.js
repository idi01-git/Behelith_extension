(function () {
  'use strict';

  let hudElement = null;
  let currentLang = 'cpp';
  let activeSettings = null;
  let debounceTimer = null;
  let localTestCases = [];
  let isSidebarOpen = false;
  let isRunning = false;
  let pendingAutoSubmit = false;

  const DEFAULT_SETTINGS = {
    editorTheme: 'vs-dark',
    fontSize: 14,
    formatOnSave: true,
    cppVersion: 'c++17',
    cppOptLevel: '-O0',
    warnIntOverflow: true,
    runEnv: 'auto',
    submitMode: 'review',
    defaultTemplateId: 'cpp-default',
    hotkeyToggleEditor: 'Ctrl+Alt+E',
    hotkeyRunCode: 'Ctrl+Alt+R',
    hotkeyFormatCode: 'Ctrl+Alt+F',
    hotkeyWordWrap: 'Alt+W',
    hotkeyHelpSection: 'Ctrl+Alt+H',
    templates: [
      {
        id: 'cpp-default',
        name: 'C++ Solve Template',
        language: 'cpp',
        code: `#include <bits/stdc++.h>
using namespace std;

void solve() {
    [cursor]
}

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    int t = 1;
    cin >> t;
    while (t--) {
        solve();
    }
    return 0;
}`,
        hotkey: 'Ctrl+Alt+T'
      },
      {
        id: 'py-default',
        name: 'Python Solve Template',
        language: 'python',
        code: `import sys

def solve():
    [cursor]
    pass

def main():
    solve()

if __name__ == "__main__":
    main()`,
        hotkey: 'Ctrl+Alt+Y'
      }
    ],
    cppTemplate: `#include <bits/stdc++.h>
using namespace std;

void solve() {
    [cursor]
}

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    int t = 1;
    cin >> t;
    while (t--) {
        solve();
    }
    return 0;
}`,
    pythonTemplate: `import sys

def solve():
    pass

def main():
    input = sys.stdin.read
    data = input().split()
    if not data:
        return
    
if __name__ == "__main__":
    main()`
  };

  function getDefaultTemplateCode(lang) {
    if (!activeSettings || !activeSettings.templates) return null;
    const defId = activeSettings.defaultTemplateId;
    if (defId) {
      const tpl = activeSettings.templates.find(t => t.id === defId && t.language === lang);
      if (tpl) return tpl.code;
    }
    // Fallback: first template matching the language
    const fallback = activeSettings.templates.find(t => t.language === lang);
    if (fallback) return fallback.code;
    // Ultimate fallback: legacy settings
    return lang === 'python' ? activeSettings.pythonTemplate : activeSettings.cppTemplate;
  }

  function getSettings(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            activeSettings = { ...DEFAULT_SETTINGS };
            callback(activeSettings);
            return;
          }
          activeSettings = { ...DEFAULT_SETTINGS, ...items };
          
          let migrated = false;
          try {
            if (activeSettings.cppTemplate && activeSettings.cppTemplate.includes('nusing namespace')) {
              activeSettings.cppTemplate = DEFAULT_SETTINGS.cppTemplate;
              chrome.storage.local.set({ cppTemplate: DEFAULT_SETTINGS.cppTemplate });
              migrated = true;
            }
            if (activeSettings.pythonTemplate && activeSettings.pythonTemplate.includes('import sysnndef')) {
              activeSettings.pythonTemplate = DEFAULT_SETTINGS.pythonTemplate;
              chrome.storage.local.set({ pythonTemplate: DEFAULT_SETTINGS.pythonTemplate });
              migrated = true;
            }
            if (!activeSettings.templates || !Array.isArray(activeSettings.templates) || activeSettings.templates.length === 0) {
              activeSettings.templates = DEFAULT_SETTINGS.templates;
              chrome.storage.local.set({ templates: DEFAULT_SETTINGS.templates });
              migrated = true;
            }
          } catch (err) {
            console.warn('[Behelith] Failed to migrate templates:', err);
          }
          
          callback(activeSettings);
        });
      } catch (e) {
        console.warn('[Behelith] Failed to access local storage:', e);
        activeSettings = { ...DEFAULT_SETTINGS };
        callback(activeSettings);
      }
    } else {
      activeSettings = { ...DEFAULT_SETTINGS };
      callback(activeSettings);
    }
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isSubmitPage() {
    return window.location.href.includes('/submit');
  }

  function getNativeTextarea() {
    return document.querySelector('textarea#sourceCodeTextarea, textarea[name="sourceCode"]');
  }

  function getSubmitMode() {
    return activeSettings?.submitMode === 'direct' ? 'direct' : 'review';
  }

  function getSubmitModeLabel() {
    return getSubmitMode() === 'direct' ? 'Final Submit' : 'Submit Code';
  }

  function getFinalSubmitButton() {
    const nativeTextarea = getNativeTextarea();
    const form = nativeTextarea?.closest('form') || document.querySelector('form[action*="/submit"]');
    const scope = form || document;
    const candidates = Array.from(scope.querySelectorAll('input[type="submit"], button[type="submit"], input.submit, button.submit'));
    return candidates.find(btn => !btn.closest('#behelith-sidebar, #behelith-hud, #behelith-editor-container'));
  }

  function setNativeTextareaValue(code) {
    const nativeTextarea = getNativeTextarea();
    if (!nativeTextarea) return false;
    nativeTextarea.dataset.behelithUpdating = 'true';
    nativeTextarea.value = code;
    nativeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    nativeTextarea.dispatchEvent(new Event('change', { bubbles: true }));
    nativeTextarea.dataset.behelithUpdating = 'false';
    return true;
  }

  function updateSubmitButtons() {
    const mode = getSubmitMode();
    const isFinalStep = isSubmitPage();
    document.querySelectorAll('.behelith-submit-action').forEach(btn => {
      btn.classList.toggle('behelith-sidebar-btn-direct', mode === 'direct' && !isFinalStep);
      btn.classList.toggle('behelith-sidebar-btn-review', mode === 'review' && !isFinalStep);
      btn.classList.toggle('behelith-sidebar-btn-final', isFinalStep);
      btn.textContent = isFinalStep ? 'Final Submit' : getSubmitModeLabel();
      btn.title = mode === 'direct'
        ? 'Paste the current code and submit it to Codeforces'
        : 'Paste the current code on the submit page for review';
    });
  }

  function finalSubmitToServer() {
    const nativeTextarea = getNativeTextarea();
    if (nativeTextarea && window._behelith_currentCode !== undefined) {
      setNativeTextareaValue(window._behelith_currentCode || '');
    }
    const submitButton = getFinalSubmitButton();
    if (!submitButton) {
      alert('Behelith could not find the Codeforces final submit button.');
      return false;
    }
    submitButton.click();
    return true;
  }

  function navigateToSubmitWithCode(code) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

    let pendingProblem = null;
    const url = window.location.href;
    if (url.includes('/contest/')) {
      const match = url.match(/\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/);
      if (match) pendingProblem = { type: 'contest', contestId: match[1], problemIndex: match[2] };
    } else if (url.includes('/gym/')) {
      const match = url.match(/\/gym\/(\d+)\/problem\/([A-Za-z0-9]+)/);
      if (match) pendingProblem = { type: 'gym', gymId: match[1], problemIndex: match[2] };
    } else if (url.includes('/problemset/problem/')) {
      const match = url.match(/\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/);
      if (match) pendingProblem = { type: 'problemset', contestId: match[1], problemIndex: match[2] };
    }

    const submitUrl = window.location.href.replace(new RegExp('/problem/.*'), '/submit');
    const pendingMode = getSubmitMode();
    try {
      chrome.storage.local.set({
        behelith_pending_submit: code,
        behelith_pending_problem: pendingProblem,
        behelith_pending_submit_mode: pendingMode
      }, () => {
        window.location.href = submitUrl;
      });
    } catch (e) {
      console.warn('[Behelith] Failed to save submit info to storage:', e);
      window.location.href = submitUrl;
    }
  }

  function handleSubmitAction() {
    const code = window._behelith_currentCode || '';
    if (isSubmitPage()) {
      finalSubmitToServer();
      return;
    }
    navigateToSubmitWithCode(code);
  }

  function matchHotkey(event, hotkeyStr) {
    if (!hotkeyStr) return false;
    const parts = hotkeyStr.split('+').map(p => p.trim().toLowerCase());
    
    let ctrlMatch = parts.includes('ctrl') === event.ctrlKey;
    let altMatch = parts.includes('alt') === event.altKey;
    let shiftMatch = parts.includes('shift') === event.shiftKey;
    let metaMatch = (parts.includes('cmd') || parts.includes('meta')) === event.metaKey;
    
    const targetKeyPart = parts.find(p => !['ctrl', 'alt', 'shift', 'cmd', 'meta'].includes(p));
    if (!targetKeyPart) return false;
    
    // Normalize event.key to match (e.g. 'Enter', 'Escape', 'ArrowUp', 'a', 'b', '1', '2')
    let eventKey = event.key.toLowerCase();
    let targetKey = targetKeyPart.toLowerCase();
    
    // For letter keys, ensure we match case-insensitively
    let keyMatch = eventKey === targetKey;
    return ctrlMatch && altMatch && shiftMatch && metaMatch && keyMatch;
  }

  let isHelpOpen = false;
  function toggleHelpPanel() {
    const helpSection = document.getElementById('behelith-help-section');
    if (!helpSection) return;
    isHelpOpen = !isHelpOpen;
    helpSection.style.display = isHelpOpen ? 'block' : 'none';
    if (isHelpOpen) {
      renderHelpContent();
    }
  }

  function renderHelpContent() {
    const list = document.getElementById('behelith-help-list');
    if (!list || !activeSettings) return;
    
    let html = `
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-weight:700;color:rgba(255,255,255,0.7);">
        <span>Action</span><span>Hotkey</span>
      </div>
      <hr style="border:0;border-top:1px solid rgba(255,255,255,0.1);margin:4px 0;"/>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;align-items:center;">
        <span>Toggle Editor</span><code style="background:rgba(255,255,255,0.15);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:10px;">${activeSettings.hotkeyToggleEditor}</code>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;align-items:center;">
        <span>Run Code</span><code style="background:rgba(255,255,255,0.15);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:10px;">${activeSettings.hotkeyRunCode}</code>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;align-items:center;">
        <span>Format Code</span><code style="background:rgba(255,255,255,0.15);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:10px;">${activeSettings.hotkeyFormatCode}</code>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;align-items:center;">
        <span>Word Wrap</span><code style="background:rgba(255,255,255,0.15);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:10px;">${activeSettings.hotkeyWordWrap}</code>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;align-items:center;">
        <span>Help Panel</span><code style="background:rgba(255,255,255,0.15);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:10px;">${activeSettings.hotkeyHelpSection}</code>
      </div>
    `;
    
    if (activeSettings.templates && activeSettings.templates.length > 0) {
      html += `
        <hr style="border:0;border-top:1px solid rgba(255,255,255,0.1);margin:8px 0;"/>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-weight:700;color:rgba(255,255,255,0.7);">
          <span>Template</span><span>Hotkey</span>
        </div>
        <hr style="border:0;border-top:1px solid rgba(255,255,255,0.1);margin:4px 0;"/>
      `;
      activeSettings.templates.forEach(t => {
        if (t.hotkey) {
          html += `
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;align-items:center;">
              <span>${escapeHTML(t.name)} (${t.language.toUpperCase()})</span>
              <code style="background:rgba(255,255,255,0.15);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:10px;">${t.hotkey}</code>
            </div>
          `;
        }
      });
    }
    
    list.innerHTML = html;
  }

  function compareOutputs(actual, expected) {
    const normalize = (str) => {
      if (!str) return '';
      return str.replace(/rn/g, 'n').split('n').map(l => l.trimEnd()).filter((l, i, arr) => l !== '' || arr.slice(i).some(x => x.trimEnd() !== '')).join('n').trim();
    };
    return normalize(actual) === normalize(expected);
  }

  function scrapeTestCases() {
    const inputElements = document.querySelectorAll('.sample-tests .input pre, .sample-test .input pre');
    const outputElements = document.querySelectorAll('.sample-tests .output pre, .sample-test .output pre');
    
    const scraped = [];
    for (let i = 0; i < inputElements.length; i++) {
      const input = (inputElements[i].innerText || inputElements[i].textContent || '').trim();
      const expected = (outputElements[i] ? (outputElements[i].innerText || outputElements[i].textContent || '') : '').trim();
      scraped.push({ input, expected, isCustom: false, status: 'idle', actual: null, stderr: null, timeMs: null });
    }
    return scraped;
  }

  function loadTestCases() {
    localTestCases = scrapeTestCases();
    const urlKey = `behelith_tests_${window.location.pathname}`;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.get([urlKey], (res) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            renderTestCases();
            return;
          }
          if (res[urlKey] && Array.isArray(res[urlKey])) {
            res[urlKey].forEach(tc => {
              localTestCases.push({ ...tc, isCustom: true, status: 'idle', actual: null, stderr: null, timeMs: null });
            });
          }
          renderTestCases();
        });
      } catch (e) {
        console.warn('[Behelith] Failed to load custom test cases:', e);
        renderTestCases();
      }
    } else {
      renderTestCases();
    }
  }

  function saveCustomTestCases() {
    const customTests = localTestCases.filter(t => t.isCustom).map(t => ({ input: t.input, expected: t.expected }));
    const urlKey = `behelith_tests_${window.location.pathname}`;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.set({ [urlKey]: customTests });
      } catch (e) {
        console.warn('[Behelith] Failed to save custom test cases:', e);
      }
    }
  }

  function renderTestCases() {
    const section = document.getElementById('behelith-local-run-section');
    if (!section) return;
    section.style.display = 'block';
    
    section.innerHTML = `
      <div class="behelith-test-cases-header">
        <div class="behelith-hud-section-title" style="margin:0;">Test Cases</div>
        <div>
          <button id="behelith-add-case-btn" class="behelith-btn-secondary">+ Add Custom</button>
        </div>
      </div>
      <div id="behelith-custom-case-form" class="behelith-custom-form" style="display: none;">
        <textarea id="behelith-custom-input" class="behelith-textarea" placeholder="Input..."></textarea>
        <textarea id="behelith-custom-expected" class="behelith-textarea" placeholder="Expected Output..."></textarea>
        <div style="display:flex; gap:8px;">
          <button id="behelith-save-custom-btn" class="behelith-btn-secondary">Save Case</button>
          <button id="behelith-cancel-custom-btn" class="behelith-btn-secondary" style="background:transparent;">Cancel</button>
        </div>
      </div>
      <div id="behelith-test-list"></div>
    `;
    
    document.getElementById('behelith-add-case-btn').onclick = () => {
      document.getElementById('behelith-custom-case-form').style.display = 'block';
    };
    document.getElementById('behelith-cancel-custom-btn').onclick = () => {
      document.getElementById('behelith-custom-case-form').style.display = 'none';
    };
    document.getElementById('behelith-save-custom-btn').onclick = () => {
      const inp = document.getElementById('behelith-custom-input').value;
      const exp = document.getElementById('behelith-custom-expected').value;
      if (inp.trim()) {
        localTestCases.push({ input: inp, expected: exp, isCustom: true, status: 'idle' });
        saveCustomTestCases();
        renderTestCases();
      }
    };
    
    const list = document.getElementById('behelith-test-list');
    if (localTestCases.length === 0) {
      list.innerHTML = '<div style="color:rgba(255,255,255,0.5);font-size:11px;padding:8px;">No test cases found.</div>';
      return;
    }
    
    localTestCases.forEach((tc, idx) => {
      let statusClass = 'idle';
      let statusText = '—';
      if (tc.status === 'pending') {
        statusClass = 'pending'; statusText = 'Pending';
      } else if (tc.status === 'success') {
        const match = compareOutputs(tc.actual, tc.expected);
        if (match) { statusClass = 'ac'; statusText = 'AC'; }
        else { statusClass = 'wa'; statusText = 'WA'; }
      } else if (tc.status === 'timeout') {
        statusClass = 'tle'; statusText = 'TLE';
      } else if (tc.status === 'runtime_error') {
        statusClass = 're'; statusText = 'RE';
      } else if (tc.status === 'compile_error') {
        statusClass = 're'; statusText = 'CE';
      } else if (tc.status === 'error') {
        statusClass = 're'; statusText = 'ERR';
      }
      
      const card = document.createElement('div');
      card.className = `behelith-test-card ${statusClass}`;
      if (statusClass === 'wa' || statusClass === 'tle' || statusClass === 're' || statusClass === 'pending') {
        card.classList.add('expanded');
      }
      if (statusClass === 'ac') {
        card.classList.remove('expanded');
      }
      
      let metaHTML = '';
      if (tc.status !== 'idle') {
        metaHTML = `<span class="behelith-badge ${statusClass}">${statusText}</span>`;
      }
      if (tc.timeMs !== undefined && tc.timeMs !== null) {
        metaHTML += `<span>${tc.timeMs}ms</span>`;
      }
      if (tc.isCustom) {
        metaHTML += `<span class="behelith-btn-secondary behelith-btn-danger" style="padding:2px 4px;margin-left:4px;font-size:9px;" id="behelith-del-tc-${idx}">Del</span>`;
      }
      
      const copyBtnStyle = 'background:transparent;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.5);padding:1px 5px;border-radius:3px;cursor:pointer;font-size:9px;margin-left:auto;';
      
      let actualDiffHTML = '';
      if (tc.actual !== undefined && tc.actual !== null) {
        const match = compareOutputs(tc.actual, tc.expected);
        const diffClass = match ? 'behelith-diff-expected' : 'behelith-diff-actual';
        actualDiffHTML = `
          <div class="behelith-data-block">
            <div class="behelith-data-title" style="display:flex;align-items:center;">Actual Output<button class="behelith-copy-btn" data-copy-target="actual-${idx}" style="${copyBtnStyle}" title="Copy">📋</button></div>
            <pre class="behelith-data-content ${diffClass}" id="behelith-actual-${idx}">${escapeHTML(tc.actual)}</pre>
          </div>
        `;
      }
      
      let stderrHTML = '';
      if (tc.stderr) {
        stderrHTML = `
          <div class="behelith-data-block">
            <div class="behelith-data-title" style="display:flex;align-items:center;">Standard Error<button class="behelith-copy-btn" data-copy-target="stderr-${idx}" style="${copyBtnStyle}" title="Copy">📋</button></div>
            <pre class="behelith-data-content behelith-diff-error" id="behelith-stderr-${idx}">${escapeHTML(tc.stderr)}</pre>
          </div>
        `;
      }
      
      card.innerHTML = `
        <div class="behelith-test-header">
          <div class="behelith-test-title">Case #${idx + 1} ${tc.isCustom ? '(Custom)' : ''}</div>
          <div class="behelith-test-meta">${metaHTML}</div>
        </div>
        <div class="behelith-test-body">
          <div class="behelith-data-block">
            <div class="behelith-data-title" style="display:flex;align-items:center;">Input<button class="behelith-copy-btn" data-copy-target="input-${idx}" style="${copyBtnStyle}" title="Copy">📋</button></div>
            <pre class="behelith-data-content" id="behelith-input-${idx}">${escapeHTML(tc.input)}</pre>
          </div>
          <div class="behelith-data-block">
            <div class="behelith-data-title" style="display:flex;align-items:center;">Expected Output<button class="behelith-copy-btn" data-copy-target="expected-${idx}" style="${copyBtnStyle}" title="Copy">📋</button></div>
            <pre class="behelith-data-content" id="behelith-expected-${idx}">${escapeHTML(tc.expected)}</pre>
          </div>
          ${actualDiffHTML}
          ${stderrHTML}
        </div>
      `;
      
      list.appendChild(card);
      
      const header = card.querySelector('.behelith-test-header');
      header.onclick = (e) => {
        if (e.target.id === `behelith-del-tc-${idx}`) {
          localTestCases.splice(idx, 1);
          saveCustomTestCases();
          renderTestCases();
        } else {
          card.classList.toggle('expanded');
        }
      };
      
      // Wire up copy buttons
      card.querySelectorAll('.behelith-copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetId = btn.getAttribute('data-copy-target');
          const pre = card.querySelector(`#behelith-${targetId}`);
          if (pre) {
            navigator.clipboard.writeText(pre.textContent).then(() => {
              const orig = btn.textContent;
              btn.textContent = '✓';
              btn.style.color = '#4caf50';
              setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1200);
            }).catch(() => {});
          }
        });
      });
    });
  }

  function updateTerminalOutputError(text) {
    const list = document.getElementById('behelith-test-list');
    if (list) {
      list.innerHTML = `
        <div class="behelith-error-item" style="margin-top:8px;">
          <strong>Compilation Error:</strong><br/>
          <pre style="white-space:pre-wrap;font-family:monospace;font-size:11px;margin-top:4px;">${escapeHTML(text)}</pre>
        </div>
      `;
    }
  }

  function renderSettingsForm(container, settings, onSettingsChangeCallback) {
    let tempTemplates = Array.isArray(settings.templates) ? [...settings.templates] : [];

    container.innerHTML = `
      <div class="behelith-form-group">
        <label class="behelith-label" for="setting-theme">Editor Theme</label>
        <select id="setting-theme" class="behelith-select">
          <option value="vs-dark" ${settings.editorTheme === 'vs-dark' ? 'selected' : ''}>vs-dark (Dark Theme)</option>
          <option value="light" ${settings.editorTheme === 'light' ? 'selected' : ''}>vs-light (Light Theme)</option>
          <option value="hc-black" ${settings.editorTheme === 'hc-black' ? 'selected' : ''}>hc-black (High Contrast)</option>
        </select>
      </div>
      <div class="behelith-form-group">
        <label class="behelith-label" for="setting-fontsize">Font Size (px)</label>
        <input type="number" id="setting-fontsize" class="behelith-input" min="10" max="24" value="${settings.fontSize}">
      </div>
      <div class="behelith-form-group">
        <label class="behelith-checkbox-label">
          <input type="checkbox" id="setting-formatonsave" ${settings.formatOnSave ? 'checked' : ''}>
          <div><span style="font-weight:600;">Auto-Format on Save</span></div>
        </label>
      </div>
      <div class="behelith-form-group">
        <label class="behelith-label" for="setting-cppversion">C++ Standard</label>
        <select id="setting-cppversion" class="behelith-select">
          <option value="c++17" ${settings.cppVersion === 'c++17' ? 'selected' : ''}>C++17 (-std=c++17)</option>
          <option value="c++20" ${settings.cppVersion === 'c++20' ? 'selected' : ''}>C++20 (-std=c++20)</option>
          <option value="c++14" ${settings.cppVersion === 'c++14' ? 'selected' : ''}>C++14 (-std=c++14)</option>
          <option value="c++11" ${settings.cppVersion === 'c++11' ? 'selected' : ''}>C++11 (-std=c++11)</option>
        </select>
      </div>
      <div class="behelith-form-group">
        <label class="behelith-label" for="setting-cppopt">Optimization Level</label>
        <select id="setting-cppopt" class="behelith-select">
          <option value="-O3" ${settings.cppOptLevel === '-O3' ? 'selected' : ''}>O3 Optimization (-O3)</option>
          <option value="-O2" ${settings.cppOptLevel === '-O2' ? 'selected' : ''}>O2 Optimization (-O2)</option>
          <option value="-O0" ${settings.cppOptLevel === '-O0' ? 'selected' : ''}>No Optimization (-O0)</option>
        </select>
      </div>
      <div class="behelith-form-group">
        <label class="behelith-checkbox-label">
          <input type="checkbox" id="setting-warnint" ${settings.warnIntOverflow ? 'checked' : ''}>
          <div><span style="font-weight:600;">Warn on 32-bit 'int' Overflow</span></div>
        </label>
      </div>
      <div class="behelith-form-group">
        <label class="behelith-label" for="setting-runenv">Run Environment</label>
        <select id="setting-runenv" class="behelith-select">
          <option value="auto" ${settings.runEnv === 'auto' ? 'selected' : ''}>Auto Fallback (Local -> Cloud)</option>
          <option value="local" ${settings.runEnv === 'local' ? 'selected' : ''}>Local Daemon Only</option>
          <option value="cloud" ${settings.runEnv === 'cloud' ? 'selected' : ''}>Cloud Sandbox Only</option>
        </select>
      </div>
      <div class="behelith-form-group">
        <label class="behelith-label" for="setting-submitmode">Submit Behavior</label>
        <select id="setting-submitmode" class="behelith-select">
          <option value="review" ${(settings.submitMode || 'review') === 'review' ? 'selected' : ''}>Review Before Final Submit</option>
          <option value="direct" ${settings.submitMode === 'direct' ? 'selected' : ''}>Direct Final Submit</option>
        </select>
        <span class="behelith-desc">Review mode pastes code on the submit page first. Direct mode pastes and submits after navigation.</span>
      </div>
      
      <div class="behelith-form-group" style="border-top:1px solid rgba(255,255,255,0.1);padding-top:10px;margin-top:12px;">
        <label class="behelith-label" style="text-transform:uppercase;font-size:10px;letter-spacing:0.5px;color:rgba(255,255,255,0.6);">Action Hotkeys</label>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px;">
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;">
            <span>Toggle Editor:</span>
            <input type="text" id="setting-hk-toggle" class="behelith-input behelith-hk-rec" style="width:120px;text-align:center;font-family:monospace;font-size:11px;padding:4px;" value="${settings.hotkeyToggleEditor || 'Ctrl+Alt+E'}" readonly>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;">
            <span>Run Code:</span>
            <input type="text" id="setting-hk-run" class="behelith-input behelith-hk-rec" style="width:120px;text-align:center;font-family:monospace;font-size:11px;padding:4px;" value="${settings.hotkeyRunCode || 'Ctrl+Alt+R'}" readonly>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;">
            <span>Format Code:</span>
            <input type="text" id="setting-hk-format" class="behelith-input behelith-hk-rec" style="width:120px;text-align:center;font-family:monospace;font-size:11px;padding:4px;" value="${settings.hotkeyFormatCode || 'Ctrl+Alt+F'}" readonly>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;">
            <span>Word Wrap:</span>
            <input type="text" id="setting-hk-wrap" class="behelith-input behelith-hk-rec" style="width:120px;text-align:center;font-family:monospace;font-size:11px;padding:4px;" value="${settings.hotkeyWordWrap || 'Alt+W'}" readonly>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;">
            <span>Help Section:</span>
            <input type="text" id="setting-hk-help" class="behelith-input behelith-hk-rec" style="width:120px;text-align:center;font-family:monospace;font-size:11px;padding:4px;" value="${settings.hotkeyHelpSection || 'Ctrl+Alt+H'}" readonly>
          </div>
        </div>
      </div>

      <div class="behelith-form-group" style="border-top:1px solid rgba(255,255,255,0.1);padding-top:10px;margin-top:12px;">
        <label class="behelith-label" style="text-transform:uppercase;font-size:10px;letter-spacing:0.5px;color:rgba(255,255,255,0.6);">Templates Manager</label>
        <div id="setting-templates-list" style="margin-top:8px;"></div>
        <button id="setting-templates-add" class="behelith-btn-secondary" style="width:100%;padding:6px;margin-top:4px;font-weight:600;">+ Add Template</button>
      </div>
    `;

    const saveSettings = () => {
      const updatedSettings = {
        editorTheme: document.getElementById('setting-theme').value,
        fontSize: parseInt(document.getElementById('setting-fontsize').value) || 14,
        formatOnSave: document.getElementById('setting-formatonsave').checked,
        cppVersion: document.getElementById('setting-cppversion').value,
        cppOptLevel: document.getElementById('setting-cppopt').value,
        warnIntOverflow: document.getElementById('setting-warnint').checked,
        runEnv: document.getElementById('setting-runenv').value,
        submitMode: document.getElementById('setting-submitmode').value,
        hotkeyToggleEditor: document.getElementById('setting-hk-toggle').value,
        hotkeyRunCode: document.getElementById('setting-hk-run').value,
        hotkeyFormatCode: document.getElementById('setting-hk-format').value,
        hotkeyWordWrap: document.getElementById('setting-hk-wrap').value,
        hotkeyHelpSection: document.getElementById('setting-hk-help').value,
        defaultTemplateId: settings.defaultTemplateId || 'cpp-default',
        templates: tempTemplates,
        cppTemplate: tempTemplates.find(t => t.language === 'cpp')?.code || settings.cppTemplate,
        pythonTemplate: tempTemplates.find(t => t.language === 'python')?.code || settings.pythonTemplate
      };

      activeSettings = updatedSettings;

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(updatedSettings);
      }
      if (onSettingsChangeCallback) {
        onSettingsChangeCallback(updatedSettings);
      }
      updateSubmitButtons();
    };

    const recordHotkey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = e.key;
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Cmd');
      parts.push(key.toUpperCase());
      e.target.value = parts.join('+');
      saveSettings();
    };

    container.querySelectorAll('.behelith-hk-rec').forEach(el => {
      el.addEventListener('keydown', recordHotkey);
    });

    container.querySelectorAll('select, input[type="checkbox"]').forEach(el => {
      el.addEventListener('change', saveSettings);
    });
    
    const fontSizeInput = document.getElementById('setting-fontsize');
    fontSizeInput.addEventListener('input', () => {
      const val = parseInt(fontSizeInput.value);
      if (val >= 10 && val <= 24) saveSettings();
    });

    const renderTemplatesList = () => {
      const listDiv = document.getElementById('setting-templates-list');
      if (!listDiv) return;
      listDiv.innerHTML = '';

      if (tempTemplates.length === 0) {
        listDiv.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:11px;text-align:center;padding:8px;">No templates created yet.</div>';
        return;
      }
      
      tempTemplates.forEach((tpl, idx) => {
        const item = document.createElement('div');
        item.style.background = 'rgba(0,0,0,0.2)';
        item.style.border = '1px solid rgba(255,255,255,0.1)';
        item.style.borderRadius = '6px';
        item.style.padding = '8px';
        item.style.marginBottom = '8px';
        const isDefault = settings.defaultTemplateId === tpl.id;
        item.innerHTML = `
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;gap:6px;">
            <input type="text" class="behelith-input tpl-name" style="flex-grow:1;font-weight:600;padding:4px 8px;" placeholder="Template Name" value="${escapeHTML(tpl.name)}" data-idx="${idx}">
            <button class="behelith-btn-secondary tpl-default" style="padding:2px 8px;font-size:10px;white-space:nowrap;${isDefault ? 'background:rgba(255,215,0,0.2);border-color:rgba(255,215,0,0.5);color:#ffd700;' : ''}" data-idx="${idx}" title="Set this template as auto-load default">${isDefault ? '★ Default' : '☆ Set Default'}</button>
            <button class="behelith-btn-secondary behelith-btn-danger tpl-del" style="padding:2px 8px;font-size:11px;" data-idx="${idx}">Delete</button>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">
            <select class="behelith-select tpl-lang" style="width:40%;height:24px;padding:2px;" data-idx="${idx}">
              <option value="cpp" ${tpl.language === 'cpp' ? 'selected' : ''}>C++</option>
              <option value="python" ${tpl.language === 'python' ? 'selected' : ''}>Python</option>
            </select>
            <input type="text" class="behelith-input behelith-hk-rec tpl-hk" style="width:60%;text-align:center;font-size:11px;padding:4px;font-family:monospace;" placeholder="Trigger Hotkey" value="${escapeHTML(tpl.hotkey || '')}" data-idx="${idx}" readonly>
          </div>
          <div>
            <textarea class="behelith-textarea tpl-code" style="font-family:monospace;font-size:11px;min-height:85px;margin-bottom:0;padding:6px;line-height:1.3;" placeholder="Code... (use [cursor] for cursor placement)" data-idx="${idx}">${escapeHTML(tpl.code)}</textarea>
          </div>
        `;
        listDiv.appendChild(item);
      });
      
      listDiv.querySelectorAll('.tpl-name').forEach(el => {
        el.addEventListener('change', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          tempTemplates[idx].name = e.target.value;
          saveSettings();
        });
      });
      listDiv.querySelectorAll('.tpl-lang').forEach(el => {
        el.addEventListener('change', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          tempTemplates[idx].language = e.target.value;
          saveSettings();
        });
      });
      listDiv.querySelectorAll('.tpl-code').forEach(el => {
        el.addEventListener('change', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          tempTemplates[idx].code = e.target.value;
          saveSettings();
        });
      });
      listDiv.querySelectorAll('.tpl-hk').forEach(el => {
        el.addEventListener('keydown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const key = e.key;
          if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;
          const parts = [];
          if (e.ctrlKey) parts.push('Ctrl');
          if (e.altKey) parts.push('Alt');
          if (e.shiftKey) parts.push('Shift');
          if (e.metaKey) parts.push('Cmd');
          parts.push(key.toUpperCase());
          
          const idx = parseInt(e.target.dataset.idx);
          tempTemplates[idx].hotkey = parts.join('+');
          e.target.value = tempTemplates[idx].hotkey;
          saveSettings();
        });
      });
      listDiv.querySelectorAll('.tpl-default').forEach(el => {
        el.addEventListener('click', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          settings.defaultTemplateId = tempTemplates[idx].id;
          renderTemplatesList();
          saveSettings();
        });
      });
      listDiv.querySelectorAll('.tpl-del').forEach(el => {
        el.addEventListener('click', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          if (settings.defaultTemplateId === tempTemplates[idx].id) {
            settings.defaultTemplateId = '';
          }
          tempTemplates.splice(idx, 1);
          renderTemplatesList();
          saveSettings();
        });
      });
    };

    const addBtn = document.getElementById('setting-templates-add');
    addBtn.addEventListener('click', () => {
      tempTemplates.push({
        id: 'tpl-' + Date.now(),
        name: 'New Template ' + (tempTemplates.length + 1),
        language: 'cpp',
        code: `// Write your code here...\n[cursor]`,
        hotkey: ''
      });
      renderTemplatesList();
      saveSettings();
    });

    renderTemplatesList();
  }

  function createHUD(onRunLocalCallback, onSettingsChangeCallback, hasNativeTextarea) {
    if (document.getElementById('behelith-hud')) return document.getElementById('behelith-hud');

    hudElement = document.createElement('div');
    hudElement.id = 'behelith-hud';
    hudElement.className = 'behelith-hud';
    hudElement.style.top = '100px';
    hudElement.style.left = `${window.innerWidth - 380}px`;

    const header = document.createElement('div');
    header.className = 'behelith-hud-header';

    const title = document.createElement('div');
    title.className = 'behelith-hud-title';
    title.innerHTML = '<span class="behelith-hud-logo"></span><span>Behelith</span>';
    const logoSpan = title.querySelector('.behelith-hud-logo');
    if (logoSpan) {
      logoSpan.style.backgroundImage = `url('${chrome.runtime.getURL('assets/hudlogo.png')}')`;
    }
    header.appendChild(title);

    const controls = document.createElement('div');
    controls.className = 'behelith-hud-controls';

    if (!hasNativeTextarea) {
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'behelith-hud-btn';
      toggleBtn.innerHTML = 'Toggle Editor';
      toggleBtn.title = 'Open side-by-side Monaco Editor';
      toggleBtn.addEventListener('click', toggleSidebarEditor);
      controls.appendChild(toggleBtn);
    }

    const runBtn = document.createElement('button');
    runBtn.id = 'behelith-run-btn';
    runBtn.className = 'behelith-hud-btn';
    runBtn.innerHTML = '▶ Run';
    runBtn.title = 'Compile & Run code';
    runBtn.addEventListener('click', () => { if (isRunning) { cancelActiveRun(); } else if (onRunLocalCallback) { onRunLocalCallback(); } });
    controls.appendChild(runBtn);

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'behelith-hud-btn';
    settingsBtn.innerHTML = '⚙️';
    controls.appendChild(settingsBtn);

    const helpBtn = document.createElement('button');
    helpBtn.className = 'behelith-hud-btn';
    helpBtn.innerHTML = '❔';
    helpBtn.title = 'Show Keyboard Shortcuts (Help)';
    helpBtn.addEventListener('click', toggleHelpPanel);
    controls.appendChild(helpBtn);

    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'behelith-hud-btn';
    minimizeBtn.innerHTML = '—';
    minimizeBtn.title = 'Minimize HUD';
    minimizeBtn.addEventListener('click', () => hudElement.classList.add('minimized'));
    controls.appendChild(minimizeBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'behelith-hud-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => hudElement.style.display = 'none');
    controls.appendChild(closeBtn);

    header.appendChild(controls);
    hudElement.appendChild(header);

    const settingsDrawer = document.createElement('div');
    settingsDrawer.className = 'behelith-settings-drawer';
    hudElement.appendChild(settingsDrawer);

    settingsBtn.addEventListener('click', () => settingsDrawer.classList.toggle('open'));

    const content = document.createElement('div');
    content.className = 'behelith-hud-content';
    content.innerHTML = `
      <div class="behelith-hud-section" id="behelith-help-section" style="display: none; transition: all 0.3s ease; margin-bottom: 12px;">
        <div class="behelith-hud-section-title" style="color:#00c6ff;">Keyboard Shortcuts</div>
        <div id="behelith-help-list" style="font-size:11px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px;"></div>
      </div>
      <div class="behelith-hud-section">
        <div class="behelith-hud-section-title">Diagnostics</div>
        <div id="behelith-diagnostics-list"><div class="behelith-success-item">✓ Code is clean. No issues detected.</div></div>
      </div>
      <div class="behelith-hud-section" id="behelith-local-run-section" style="display: none;"></div>
    `;
    hudElement.appendChild(content);
    document.body.appendChild(hudElement);

    getSettings((settings) => {
      renderSettingsForm(settingsDrawer, settings, onSettingsChangeCallback);
      if (onSettingsChangeCallback) onSettingsChangeCallback(settings);
    });

    let isDragging = false, startX, startY, initialLeft, initialTop;
    let dragDistance = 0;
    header.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      isDragging = true;
      dragDistance = 0;
      startX = e.clientX; startY = e.clientY;
      const rect = hudElement.getBoundingClientRect();
      initialLeft = rect.left; initialTop = rect.top;
      header.setPointerCapture(e.pointerId);
    });
    header.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      dragDistance += Math.abs(dx) + Math.abs(dy);
      let newLeft = Math.max(0, Math.min(initialLeft + dx, window.innerWidth - hudElement.offsetWidth));
      let newTop = Math.max(0, Math.min(initialTop + dy, window.innerHeight - hudElement.offsetHeight));
      hudElement.style.left = `${newLeft}px`; hudElement.style.top = `${newTop}px`;
    });
    header.addEventListener('pointerup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      header.releasePointerCapture(e.pointerId);
      if (hudElement.classList.contains('minimized') && dragDistance < 10) {
        hudElement.classList.remove('minimized');
      }
    });

    return hudElement;
  }

  function showHUD() {
    if (hudElement) hudElement.style.display = 'flex';
  }

  function updateHUDDiagnostics(diagnostics) {
    const diagnosticsList = document.getElementById('behelith-diagnostics-list');
    if (!diagnosticsList) return;
    
    if (!diagnostics || diagnostics.length === 0) {
      diagnosticsList.innerHTML = '<div class="behelith-success-item">✓ Code is clean. No issues detected.</div>';
      return;
    }
    
    let html = '';
    diagnostics.forEach(d => {
      const isError = d.severity === 'error';
      const className = isError ? 'behelith-error-item' : 'behelith-warning-item';
      html += `<div class="${className}">[Line ${d.startLineNumber}, Col ${d.startColumn}] ${d.message}</div>`;
    });
    
    diagnosticsList.innerHTML = html;
  }

  function getEditorCode() {
    const nativeTextarea = getNativeTextarea();
    if (nativeTextarea) return nativeTextarea.value;
    return window._behelith_currentCode || '';
  }

  function handleSettingsChange(newSettings) {
    activeSettings = newSettings;
    updateSubmitButtons();
    const iframe = document.getElementById('behelith-editor-iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'BEHELITH_UPDATE_SETTINGS', settings: newSettings }, '*');
    }
  }

  function cancelActiveRun() {
    isRunning = false;
    updateRunButtonState();
    
    localTestCases.forEach(tc => {
      if (tc.status === 'pending') {
        tc.status = 'compile_error';
        tc.stderr = 'Execution cancelled by user.';
      }
    });
    renderTestCases();

    try {
      chrome.runtime.sendMessage({ type: 'BEHELITH_CANCEL_RUN' });
    } catch (e) {
      console.warn('[Behelith] Failed to send cancel message:', e);
    }
  }

  function updateRunButtonState() {
    const runBtn = document.getElementById('behelith-run-btn');
    if (!runBtn) return;
    if (isRunning) {
      runBtn.innerHTML = '■ Stop';
      runBtn.title = 'Cancel running compilation/execution';
      runBtn.style.color = 'var(--berserk-accent)';
      runBtn.style.borderColor = 'rgba(230, 0, 0, 0.3)';
    } else {
      runBtn.innerHTML = '▶ Run';
      runBtn.title = 'Compile & Run code';
      runBtn.style.color = '';
      runBtn.style.borderColor = '';
    }
  }

  function triggerLocalRun() {
    const code = getEditorCode();
    if (!code) return;
    
    if (localTestCases.length === 0) {
      const section = document.getElementById('behelith-local-run-section');
      if (section) {
          section.style.display = 'block';
          section.innerHTML = '<div style="color:rgba(255,255,255,0.5);font-size:11px;padding:8px;">No test cases found to run! Add a custom case.</div>';
      }
      return;
    }

    isRunning = true;
    updateRunButtonState();
    
    localTestCases.forEach(tc => { tc.status = 'pending'; tc.actual = null; tc.stderr = null; tc.timeMs = null; });
    renderTestCases();

    const inputs = localTestCases.map(tc => tc.input);
    try {
      chrome.runtime.sendMessage({
        type: 'BEHELITH_RUN_CODE',
        code: code,
        language: currentLang,
        inputs: inputs,
        cppVersion: activeSettings?.cppVersion || 'c++17',
        cppOptLevel: activeSettings?.cppOptLevel || '-O0',
        runEnv: activeSettings?.runEnv || 'auto'
      });
    } catch (e) {
      console.warn('[Behelith] Failed to send local run message:', e);
      isRunning = false;
      updateRunButtonState();
      localTestCases.forEach(tc => { if (tc.status === 'pending') tc.status = 'error'; });
      renderTestCases();
      updateTerminalOutputError('Extension context invalidated. Please reload the page to run again.');
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (!message || typeof message.type !== 'string') return;
        if (message.type === 'BEHELITH_RUN_RESULT') {
          if (!isRunning) return;
          isRunning = false;
          updateRunButtonState();
          const status = message.status || (message.data && message.data.status);
          const output = message.output || (message.data && message.data.output);
          
          // Forward compiler/runtime diagnostics to the Monaco iframe
          const iframe = document.getElementById('behelith-editor-iframe');
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
              type: 'BEHELITH_COMPILER_DIAGNOSTICS',
              diagnostics: message.diagnostics || []
            }, '*');
          }
          
          if (status === 'compile_error' || status === 'error') {
            localTestCases.forEach(tc => { if (tc.status === 'pending') tc.status = 'error'; });
            renderTestCases();
            updateTerminalOutputError(output || 'Unknown compilation or connection error');
            return;
          }

          if (message.data && message.data.results) {
            const results = message.data.results;
            for (let i = 0; i < localTestCases.length && i < results.length; i++) {
              localTestCases[i].status = results[i].status;
              localTestCases[i].actual = results[i].stdout;
              localTestCases[i].stderr = results[i].stderr;
              localTestCases[i].timeMs = results[i].time_ms;
            }
            renderTestCases();
          } else {
            localTestCases.forEach(tc => { if (tc.status === 'pending') tc.status = 'error'; });
            renderTestCases();
            updateTerminalOutputError('Local run completed but returned no test case results.');
          }
        }
      });
    } catch (e) {
      console.warn('[Behelith] Failed to add runtime message listener:', e);
    }
  }

  function createLangDropdown() {
    const langSelect = document.createElement('select');
    langSelect.className = 'behelith-hud-lang-select behelith-lang-dropdown';
    langSelect.title = 'Select language for editor & submission';
    langSelect.innerHTML = `
      <option value="cpp" ${currentLang === 'cpp' ? 'selected' : ''}>C++</option>
      <option value="python" ${currentLang === 'python' ? 'selected' : ''}>Python</option>
    `;
    langSelect.addEventListener('change', () => {
      const newLang = langSelect.value;
      if (newLang === currentLang) return;
      currentLang = newLang;
      // Update Monaco editor language
      const iframe = document.getElementById('behelith-editor-iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'BEHELITH_SET_LANGUAGE', language: currentLang }, '*');
      }
      // Sync native Codeforces language dropdown
      setHostLanguage(currentLang);
      // Keep all lang dropdowns in sync
      document.querySelectorAll('.behelith-lang-dropdown').forEach(sel => {
        if (sel !== langSelect) sel.value = currentLang;
      });
      // Load default template for the new language if editor is empty
      const code = getEditorCode();
      if (!code || code.trim() === '') {
        const tplCode = getDefaultTemplateCode(currentLang);
        if (tplCode && iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'BEHELITH_UPDATE_CODE', code: tplCode }, '*');
          window._behelith_currentCode = tplCode;
        }
      }
    });
    return langSelect;
  }

  function toggleSidebarEditor() {
    let panel = document.getElementById('behelith-sidebar');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'behelith-sidebar';
      panel.className = 'behelith-sidebar-panel';
      panel.innerHTML = `
        <div class="behelith-sidebar-resizer" id="behelith-sidebar-resizer"></div>
        <div class="behelith-sidebar-header">
          <div>Behelith Editor</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span id="behelith-sidebar-lang-slot"></span>
            <button id="behelith-sidebar-submit" class="behelith-sidebar-btn behelith-submit-action">Submit Code</button>
            <button id="behelith-sidebar-close" class="behelith-sidebar-close">✕</button>
          </div>
        </div>
        <div class="behelith-sidebar-editor" id="behelith-sidebar-editor-container"></div>
      `;
      document.body.appendChild(panel);
      
      // Insert language dropdown into the sidebar header
      const sidebarLangSlot = document.getElementById('behelith-sidebar-lang-slot');
      if (sidebarLangSlot) sidebarLangSlot.appendChild(createLangDropdown());
      
      document.getElementById('behelith-sidebar-close').onclick = toggleSidebarEditor;
      
      // submit handler
      const submitBtn = document.getElementById('behelith-sidebar-submit');
      if (submitBtn) {
        submitBtn.onclick = handleSubmitAction;
        updateSubmitButtons();
      }

      const iframe = document.createElement('iframe');
      iframe.id = 'behelith-editor-iframe';
      iframe.src = chrome.runtime.getURL('sandbox/editor.html');
      iframe.style.width = '100%'; iframe.style.height = '100%'; iframe.style.border = 'none';
      document.getElementById('behelith-sidebar-editor-container').appendChild(iframe);

      // Resize handle mouse events
      const resizer = panel.querySelector('#behelith-sidebar-resizer');
      let isResizing = false;
      let startWidth = 0;
      let startX = 0;

      resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = panel.getBoundingClientRect().width;
        
        document.body.style.userSelect = 'none';
        iframe.style.pointerEvents = 'none'; // Prevent iframe from swallowing mousemove
        document.body.style.transition = 'none';
        panel.style.transition = 'none';
        resizer.classList.add('active');
      });

      document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const deltaX = startX - e.clientX;
        const newWidth = startWidth + deltaX;
        
        const minWidth = 320;
        const maxWidth = window.innerWidth * 0.8;
        const clampedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
        
        panel.style.width = `${clampedWidth}px`;
        document.body.style.width = `${window.innerWidth - clampedWidth}px`;
      });

      document.addEventListener('mouseup', () => {
        if (isResizing) {
          isResizing = false;
          document.body.style.userSelect = '';
          iframe.style.pointerEvents = 'auto';
          resizer.classList.remove('active');
        }
      });
    }
    
    if (isSidebarOpen) {
      panel.classList.remove('open');
      document.body.style.width = '100%';
      document.body.style.transition = 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    } else {
      panel.classList.add('open');
      const currentPanelWidth = panel.style.width || '50%';
      panel.style.width = currentPanelWidth;
      if (currentPanelWidth.endsWith('px')) {
        const pxVal = parseInt(currentPanelWidth, 10);
        document.body.style.width = `${window.innerWidth - pxVal}px`;
      } else {
        document.body.style.width = '50%';
      }
      document.body.style.transition = 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    }
    isSidebarOpen = !isSidebarOpen;
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message.type !== 'string' || !message.type.startsWith('BEHELITH_')) return;
    const iframe = document.getElementById('behelith-editor-iframe');
    if (!iframe) return;
    if (event.source !== iframe.contentWindow) return;

    if (message.type === 'BEHELITH_SANDBOX_READY') {
      let initialCode = '';
      const nativeTextarea = document.querySelector('textarea#sourceCodeTextarea, textarea[name="sourceCode"]');
      if (nativeTextarea) {
        initialCode = nativeTextarea.value;
      }
      
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          chrome.storage.local.get(['behelith_pending_submit', 'behelith_pending_submit_mode', `behelith_code_${window.location.pathname}`], (res) => {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
              iframe.contentWindow.postMessage({ type: 'BEHELITH_INIT_CODE', code: initialCode, language: currentLang, settings: activeSettings }, '*');
              return;
            }
            if (res.behelith_pending_submit) {
               initialCode = res.behelith_pending_submit;
               if (nativeTextarea) {
                   setNativeTextareaValue(initialCode);
               }
               pendingAutoSubmit = res.behelith_pending_submit_mode === 'direct';
               try {
                 chrome.storage.local.remove(['behelith_pending_submit', 'behelith_pending_submit_mode']);
               } catch (err) {}
            } else if (!nativeTextarea && res[`behelith_code_${window.location.pathname}`]) {
               initialCode = res[`behelith_code_${window.location.pathname}`];
            }
            
            if (!initialCode || initialCode.trim() === '') {
              initialCode = getDefaultTemplateCode(currentLang) || (currentLang === 'python' ? activeSettings.pythonTemplate : activeSettings.cppTemplate);
              if (nativeTextarea) {
                   nativeTextarea.value = initialCode;
                   nativeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
            window._behelith_currentCode = initialCode;
            iframe.contentWindow.postMessage({ type: 'BEHELITH_INIT_CODE', code: initialCode, language: currentLang, settings: activeSettings }, '*');
            updateSubmitButtons();
            if (pendingAutoSubmit && isSubmitPage()) {
              pendingAutoSubmit = false;
              setTimeout(finalSubmitToServer, 700);
            }
          });
        } catch (e) {
          iframe.contentWindow.postMessage({ type: 'BEHELITH_INIT_CODE', code: initialCode, language: currentLang, settings: activeSettings }, '*');
        }
      } else {
        iframe.contentWindow.postMessage({ type: 'BEHELITH_INIT_CODE', code: initialCode, language: currentLang, settings: activeSettings }, '*');
      }
    } else if (message.type === 'BEHELITH_SANDBOX_ERROR') {
      console.error('[CP-Lens Host] Editor error received:', message);
      updateTerminalOutputError(`[Editor Error] ${message.message}\nStack: ${message.error || 'N/A'}`);
      alert(`Behelith Editor Crash:\n${message.message}\n\nCheck HUD terminal for stack trace.`);
    } else if (message.type === 'BEHELITH_REQUEST_TEMPLATE') {
      const template = getDefaultTemplateCode(currentLang) || (currentLang === 'python' ? activeSettings.pythonTemplate : activeSettings.cppTemplate);
      iframe.contentWindow.postMessage({ type: 'BEHELITH_UPDATE_CODE', code: template }, '*');
      window._behelith_currentCode = template;
      const nativeTextarea = document.querySelector('textarea#sourceCodeTextarea, textarea[name="sourceCode"]');
      if (nativeTextarea) {
        nativeTextarea.dataset.behelithUpdating = 'true';
        nativeTextarea.value = template;
        nativeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        nativeTextarea.dataset.behelithUpdating = 'false';
      } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          chrome.storage.local.set({ [`behelith_code_${window.location.pathname}`]: template });
        } catch (e) {}
      }
    } else if (message.type === 'BEHELITH_CODE_CHANGE') {
      window._behelith_currentCode = message.code;
      const nativeTextarea = document.querySelector('textarea#sourceCodeTextarea, textarea[name="sourceCode"]');
      if (nativeTextarea) {
        nativeTextarea.dataset.behelithUpdating = 'true';
        nativeTextarea.value = message.code;
        nativeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        nativeTextarea.dataset.behelithUpdating = 'false';
      } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          chrome.storage.local.set({ [`behelith_code_${window.location.pathname}`]: message.code });
        } catch (e) {}
      }
    } else if (message.type === 'BEHELITH_DIAGNOSTICS_CHANGE') {
      updateHUDDiagnostics(message.diagnostics);
    } else if (message.type === 'BEHELITH_ACTION_TOGGLE_EDITOR') {
      const hasNativeTextarea = !!document.querySelector('textarea#sourceCodeTextarea, textarea[name="sourceCode"]');
      if (!hasNativeTextarea) {
        toggleSidebarEditor();
      }
    } else if (message.type === 'BEHELITH_ACTION_RUN') {
      triggerLocalRun();
    } else if (message.type === 'BEHELITH_ACTION_HELP') {
      toggleHelpPanel();
    } else if (message.type === 'BEHELITH_LANGUAGE_CHANGED_BY_TEMPLATE') {
      setHostLanguage(message.language);
    } else if (message.type === 'BEHELITH_SCROLL_PARENT') {
      window.scrollBy({ top: message.deltaY, behavior: 'auto' });
    }
  });

  function setHostLanguage(lang) {
    currentLang = lang;
    const langSelector = document.querySelector('select[name="programTypeId"]');
    if (langSelector) {
      let foundIndex = -1;
      // First pass: try to find a preferred compiler
      for (let i = 0; i < langSelector.options.length; i++) {
        const text = langSelector.options[i].text.toLowerCase();
        if (lang === 'cpp') {
          if (text.includes('g++20') || text.includes('g++17')) {
            foundIndex = i;
            break;
          }
        } else if (lang === 'python') {
          if (text.includes('pypy 3')) {
            foundIndex = i;
            break;
          }
        }
      }
      // Second pass: fallback if preferred not found
      if (foundIndex === -1) {
        for (let i = 0; i < langSelector.options.length; i++) {
          const text = langSelector.options[i].text.toLowerCase();
          if (lang === 'cpp' && (text.includes('c++') || text.includes('g++'))) {
            foundIndex = i;
            break;
          } else if (lang === 'python' && text.includes('python')) {
            foundIndex = i;
            break;
          }
        }
      }
      if (foundIndex !== -1) {
        langSelector.selectedIndex = foundIndex;
        langSelector.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  function injectMonaco() {
    const nativeTextarea = document.querySelector('textarea#sourceCodeTextarea, textarea[name="sourceCode"]');
    const hasNativeTextarea = !!nativeTextarea;

    if (document.getElementById('behelith-hud')) return true;

    // Check if we are on a valid problem or submit page before injecting
    const isProblemOrSubmit = window.location.href.includes('/problem') || window.location.href.includes('/submit');
    if (!isProblemOrSubmit) return false;

    getSettings((loadedSettings) => {
      activeSettings = loadedSettings;
      createHUD(triggerLocalRun, handleSettingsChange, hasNativeTextarea);
      showHUD();
      loadTestCases();
      
      if (!hasNativeTextarea) {
        toggleSidebarEditor();
      }
    });

    if (hasNativeTextarea) {
      nativeTextarea.style.display = 'none';
      const cfEditor = document.querySelector('.editor, #editor');
      if (cfEditor) cfEditor.style.display = 'none';

      const container = document.createElement('div');
      container.id = 'behelith-editor-container';
      container.style.width = '100%'; container.style.height = '600px';
      container.style.border = '1px solid rgba(255, 255, 255, 0.1)';
      container.style.borderRadius = '8px'; container.style.overflow = 'hidden';
      container.style.margin = '12px 0'; container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';

      // Toolbar above the inline editor with language dropdown
      const editorToolbar = document.createElement('div');
      editorToolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:rgba(0,0,0,0.3);border-bottom:1px solid rgba(255,255,255,0.1);';
      editorToolbar.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:11px;color:rgba(255,255,255,0.5);font-weight:600;">Language:</span></div>';
      const toolbarLeft = editorToolbar.firstElementChild;
      toolbarLeft.appendChild(createLangDropdown());
      if (isSubmitPage()) {
        const finalSubmitBtn = document.createElement('button');
        finalSubmitBtn.id = 'behelith-inline-submit';
        finalSubmitBtn.className = 'behelith-sidebar-btn behelith-submit-action';
        finalSubmitBtn.type = 'button';
        finalSubmitBtn.onclick = handleSubmitAction;
        editorToolbar.appendChild(finalSubmitBtn);
        updateSubmitButtons();
      }
      container.appendChild(editorToolbar);

      const iframe = document.createElement('iframe');
      iframe.id = 'behelith-editor-iframe';
      iframe.src = chrome.runtime.getURL('sandbox/editor.html');
      iframe.style.width = '100%'; iframe.style.height = '100%'; iframe.style.border = 'none';
      container.appendChild(iframe);

      nativeTextarea.parentNode.insertBefore(container, nativeTextarea);
      
      const syncToMonaco = (newCode) => {
        if (iframe && iframe.contentWindow && newCode !== undefined) {
          if (nativeTextarea.dataset.behelithUpdating === 'true') return;
          iframe.contentWindow.postMessage({ type: 'BEHELITH_UPDATE_CODE', code: newCode }, '*');
        }
      };

      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (descriptor) {
        const originalSet = descriptor.set;
        Object.defineProperty(nativeTextarea, 'value', {
          get: descriptor.get,
          set: function(val) { originalSet.call(this, val); syncToMonaco(val); }
        });
      }
      nativeTextarea.addEventListener('input', (e) => { if (e.isTrusted) syncToMonaco(e.target.value); });
    }

    const langSelector = document.querySelector('select[name="programTypeId"]');
    if (langSelector) {
      langSelector.addEventListener('change', () => {
        currentLang = (langSelector.options[langSelector.selectedIndex].text.toLowerCase().includes('python')) ? 'python' : 'cpp';
        const iframe = document.getElementById('behelith-editor-iframe');
        if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'BEHELITH_SET_LANGUAGE', language: currentLang }, '*');
        // Keep all lang dropdowns in sync
        document.querySelectorAll('.behelith-lang-dropdown').forEach(sel => { sel.value = currentLang; });
      });
    }

    return true;
  }

  function handleSubmitAutoSelection() {
    if (!window.location.href.includes('/submit')) return;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.get(['behelith_pending_problem'], (res) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) return;
          const pending = res.behelith_pending_problem;
          if (!pending) return;
          
          let found = false;
          if (pending.type === 'contest' || pending.type === 'gym') {
            const select = document.querySelector('select[name="submittedProblemIndex"]');
            if (select) {
              for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].value.toUpperCase() === pending.problemIndex.toUpperCase()) {
                  select.selectedIndex = i;
                  select.dispatchEvent(new Event('change', { bubbles: true }));
                  found = true;
                  break;
                }
              }
            }
          } else if (pending.type === 'problemset') {
            const input = document.querySelector('input[name="submittedProblemCode"]');
            if (input) {
              input.value = pending.contestId + pending.problemIndex;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              found = true;
            }
          }
          
          if (found) {
             try {
               chrome.storage.local.remove(['behelith_pending_problem']);
             } catch (err) {}
          }
        });
      } catch (e) {
        console.warn('[Behelith] Failed to retrieve pending problem selection:', e);
      }
    }
  }
  document.addEventListener('keydown', (e) => {
    // Skip if user is typing in an input or textarea
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
      if (!activeEl.classList.contains('behelith-hk-rec')) {
        return; 
      }
    }
    
    if (!activeSettings) return;

    if (matchHotkey(e, activeSettings.hotkeyToggleEditor)) {
      e.preventDefault();
      const hasNativeTextarea = !!document.querySelector('textarea#sourceCodeTextarea, textarea[name="sourceCode"]');
      if (!hasNativeTextarea) {
        toggleSidebarEditor();
      }
    } else if (matchHotkey(e, activeSettings.hotkeyRunCode)) {
      e.preventDefault();
      triggerLocalRun();
    } else if (matchHotkey(e, activeSettings.hotkeyHelpSection)) {
      e.preventDefault();
      toggleHelpPanel();
    } else if (matchHotkey(e, activeSettings.hotkeyWordWrap)) {
      e.preventDefault();
      const iframe = document.getElementById('behelith-editor-iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'BEHELITH_TOGGLE_WORD_WRAP' }, '*');
      }
    } else if (matchHotkey(e, activeSettings.hotkeyFormatCode)) {
      e.preventDefault();
      const iframe = document.getElementById('behelith-editor-iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'BEHELITH_FORMAT_CODE' }, '*');
      }
    } else if (activeSettings.templates && Array.isArray(activeSettings.templates)) {
      for (const tpl of activeSettings.templates) {
        if (tpl.hotkey && matchHotkey(e, tpl.hotkey)) {
          e.preventDefault();
          const iframe = document.getElementById('behelith-editor-iframe');
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'BEHELITH_LOAD_TEMPLATE', template: tpl }, '*');
          }
          break;
        }
      }
    }
  });

  handleSubmitAutoSelection();

  if (!injectMonaco()) {
    const observer = new MutationObserver((mutations, obs) => {
      if (injectMonaco()) obs.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

})();

