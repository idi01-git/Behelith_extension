window.addEventListener('error', (event) => {
  window.parent.postMessage({
    type: 'BEHELITH_SANDBOX_ERROR',
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error ? event.error.stack : null
  }, '*');
});
window.addEventListener('unhandledrejection', (event) => {
  window.parent.postMessage({
    type: 'BEHELITH_SANDBOX_ERROR',
    message: event.reason ? (event.reason.message || String(event.reason)) : 'Unhandled promise rejection',
    error: event.reason && event.reason.stack ? event.reason.stack : null
  }, '*');
});

import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import initClangFormat, { format as clangFormat } from '@wasm-fmt/clang-format/web';
import initRuff, { Workspace, PositionEncoding } from '@astral-sh/ruff-wasm-web';

self.MonacoEnvironment = {
  getWorker(moduleId, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  }
};

let editor;
let clangFormatReady = false;
let ruffReady = false;
let ruffWorkspace = null;
let formatOnSave = true;

// Initialize the formatters immediately
async function initFormatters() {
  try {
    console.log('[Behelith Sandbox] Initializing Clang-Format WASM...');
    await initClangFormat('./clang-format.wasm');
    clangFormatReady = true;
    console.log('[Behelith Sandbox] Clang-Format WASM ready');
  } catch (err) {
    console.error('[Behelith Sandbox] Failed to initialize Clang-Format WASM:', err);
  }

  try {
    console.log('[Behelith Sandbox] Initializing Ruff WASM...');
    await initRuff('./ruff.wasm');
    ruffWorkspace = new Workspace({
      'line-length': 88,
      format: {
        'quote-style': 'double',
      }
    }, PositionEncoding.UTF16);
    ruffReady = true;
    console.log('[Behelith Sandbox] Ruff WASM ready');
    if (editor && editor.getModel() && editor.getModel().getLanguageId() === 'python') {
      runDiagnostics();
    }
  } catch (err) {
    console.error('[Behelith Sandbox] Failed to initialize Ruff WASM:', err);
  }
}

// Call formatter initialization
initFormatters();

// Preprocess C++ code: strip strings and comments by replacing them with spaces.
function preprocessCppCode(code) {
  let cleaned = '';
  let i = 0;
  const len = code.length;
  while (i < len) {
    const char = code[i];
    if (char === '\n') {
      cleaned += '\n';
      i++;
    } else if (char === '/' && code[i + 1] === '/') {
      cleaned += '  ';
      i += 2;
      while (i < len && code[i] !== '\n') {
        cleaned += ' ';
        i++;
      }
    } else if (char === '/' && code[i + 1] === '*') {
      cleaned += '  ';
      i += 2;
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') {
          cleaned += '\n';
        } else {
          cleaned += ' ';
          i++;
        }
      }
      if (i < len) {
        cleaned += '  ';
        i += 2;
      }
    } else if (char === '"') {
      cleaned += ' ';
      i++;
      while (i < len && code[i] !== '"') {
        if (code[i] === '\\' && i + 1 < len) {
          cleaned += (code[i + 1] === '\n') ? '\\\n' : '  ';
          i += 2;
        } else {
          cleaned += (code[i] === '\n') ? '\n' : ' ';
          i++;
        }
      }
      if (i < len) {
        cleaned += ' ';
        i++;
      }
    } else if (char === "'") {
      cleaned += ' ';
      i++;
      while (i < len && code[i] !== "'") {
        if (code[i] === '\\' && i + 1 < len) {
          cleaned += (code[i + 1] === '\n') ? '\\\n' : '  ';
          i += 2;
        } else {
          cleaned += (code[i] === '\n') ? '\n' : ' ';
          i++;
        }
      }
      if (i < len) {
        cleaned += ' ';
        i++;
      }
    } else {
      cleaned += char;
      i++;
    }
  }
  return cleaned;
}

// Perform basic C++ linting: checks for unmatched brackets and missing semicolons
function performBasicCppLinting(code) {
  const diagnostics = [];
  const stack = [];
  
  let i = 0;
  let line = 1;
  let col = 1;
  const len = code.length;
  
  while (i < len) {
    const char = code[i];
    
    if (char === '\n') {
      line++;
      col = 1;
      i++;
      continue;
    }
    
    if (char === '/' && code[i + 1] === '/') {
      while (i < len && code[i] !== '\n') {
        i++;
        col++;
      }
      continue;
    }
    
    if (char === '/' && code[i + 1] === '*') {
      i += 2;
      col += 2;
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') {
          line++;
          col = 1;
        } else {
          col++;
        }
        i++;
      }
      if (i < len) {
        i += 2;
        col += 2;
      }
      continue;
    }
    
    if (char === '"') {
      const startLine = line;
      const startCol = col;
      i++;
      col++;
      let closed = false;
      while (i < len) {
        if (code[i] === '"') {
          closed = true;
          i++;
          col++;
          break;
        }
        if (code[i] === '\\' && i + 1 < len) {
          if (code[i + 1] === '\n') {
            line++;
            col = 1;
          } else {
            col += 2;
          }
          i += 2;
        } else {
          if (code[i] === '\n') {
            line++;
            col = 1;
          } else {
            col++;
          }
          i++;
        }
      }
      if (!closed) {
        diagnostics.push({
          severity: 'error',
          message: 'Unterminated string literal',
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: line,
          endColumn: col
        });
      }
      continue;
    }
    
    if (char === "'") {
      const startLine = line;
      const startCol = col;
      i++;
      col++;
      let closed = false;
      while (i < len) {
        if (code[i] === "'") {
          closed = true;
          i++;
          col++;
          break;
        }
        if (code[i] === '\\' && i + 1 < len) {
          if (code[i + 1] === '\n') {
            line++;
            col = 1;
          } else {
            col += 2;
          }
          i += 2;
        } else {
          if (code[i] === '\n') {
            line++;
            col = 1;
          } else {
            col++;
          }
          i++;
        }
      }
      if (!closed) {
        diagnostics.push({
          severity: 'error',
          message: 'Unterminated character literal',
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: line,
          endColumn: col
        });
      }
      continue;
    }
    
    if (char === '(' || char === '[' || char === '{') {
      stack.push({ char, line, col });
    } else if (char === ')' || char === ']' || char === '}') {
      const last = stack.length > 0 ? stack[stack.length - 1] : null;
      const expected = char === ')' ? '(' : char === ']' ? '[' : '{';
      if (!last) {
        diagnostics.push({
          severity: 'error',
          message: `Unmatched closing bracket '${char}'`,
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: col + 1
        });
      } else if (last.char !== expected) {
        diagnostics.push({
          severity: 'error',
          message: `Mismatched bracket: expected '${char === ')' ? ')' : char === ']' ? ']' : '}'}' for '${last.char}' at line ${last.line}, col ${last.col}`,
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: col + 1
        });
        stack.pop();
      } else {
        stack.pop();
      }
    }
    
    i++;
    col++;
  }
  
  while (stack.length > 0) {
    const open = stack.pop();
    diagnostics.push({
      severity: 'error',
      message: `Unclosed bracket '${open.char}'`,
      startLineNumber: open.line,
      startColumn: open.col,
      endLineNumber: open.line,
      endColumn: open.col + 1
    });
  }

  // Missing semicolon checks using the cleaned code
  const cleaned = preprocessCppCode(code);
  const lines = cleaned.split('\n');
  const ignoreRegex = /^\s*(if|else|for|while|struct|class|union|enum|namespace|template|rep|loop|trav|each|ford)\b/;
  
  for (let idx = 0; idx < lines.length; idx++) {
    const trimmed = lines[idx].trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('//')) continue;
    
    if (/[;{},\(\)\[\]\+\-\*\/&\|=\?:!<>\\%]$/.test(trimmed)) continue;
    if (ignoreRegex.test(trimmed)) continue;
    
    let nextTrimmed = '';
    for (let j = idx + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t !== '') {
        nextTrimmed = t;
        break;
      }
    }
    if (nextTrimmed.startsWith('{')) {
      continue;
    }
    
    diagnostics.push({
      severity: 'error',
      message: "Expected ';'",
      startLineNumber: idx + 1,
      startColumn: lines[idx].length + 1,
      endLineNumber: idx + 1,
      endColumn: lines[idx].length + 2
    });
  }
  
  return diagnostics;
}

let diagnosticsTimeout = null;
function scheduleDiagnostics() {
  if (diagnosticsTimeout) {
    clearTimeout(diagnosticsTimeout);
  }
  diagnosticsTimeout = setTimeout(runDiagnostics, 350);
}

function runDiagnostics() {
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;
  const language = model.getLanguageId();
  const code = editor.getValue();
  
  let markers = [];
  
  if (language === 'python') {
    if (ruffReady && ruffWorkspace) {
      try {
        const ruffDiagnostics = ruffWorkspace.check(code) || [];
        for (const d of ruffDiagnostics) {
          if (d.start_location && d.end_location) {
            const isError = d.code && (d.code.startsWith('E9') || d.code.startsWith('F'));
            markers.push({
              severity: isError ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
              message: `${d.code ? `[${d.code}] ` : ''}${d.message}`,
              startLineNumber: d.start_location.row,
              startColumn: d.start_location.column,
              endLineNumber: d.end_location.row,
              endColumn: d.end_location.column
            });
          }
        }
      } catch (err) {
        console.error('[Behelith Sandbox] Ruff diagnostics error:', err);
      }
    }
  } else if (language === 'cpp' || language === 'c') {
    try {
      const cppDiagnostics = performBasicCppLinting(code) || [];
      for (const d of cppDiagnostics) {
        markers.push({
          severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: d.startLineNumber,
          startColumn: d.startColumn,
          endLineNumber: d.endLineNumber,
          endColumn: d.endColumn
        });
      }
    } catch (err) {
      console.error('[Behelith Sandbox] C++ diagnostics error:', err);
    }
  }
  
  monaco.editor.setModelMarkers(model, 'behelith_diagnostics', markers);
  
  // Post diagnostics list to parent window
  window.parent.postMessage({
    type: 'BEHELITH_DIAGNOSTICS_CHANGE',
    diagnostics: markers.map(m => ({
      severity: m.severity === monaco.MarkerSeverity.Error ? 'error' : 'warning',
      message: m.message,
      startLineNumber: m.startLineNumber,
      startColumn: m.startColumn,
      endLineNumber: m.endLineNumber,
      endColumn: m.endColumn
    }))
  }, '*');
}

// Function to format the code inside the editor
async function formatCode() {
  if (!editor) return;

  const model = editor.getModel();
  const language = model.getLanguageId();
  const code = editor.getValue();

  console.log(`[Behelith Sandbox] Formatting requested for language: ${language}`);

  if (language === 'cpp' || language === 'c' || language === 'java') {
    if (!clangFormatReady) {
      console.warn('[Behelith Sandbox] Clang-Format is not ready yet');
      return;
    }
    try {
      const formatted = clangFormat(code, 'solution.cpp', 'Google');
      if (formatted !== code) {
        editor.setValue(formatted);
        console.log('[Behelith Sandbox] Code formatted using Clang-Format');
      }
    } catch (err) {
      console.error('[Behelith Sandbox] Clang-Format error:', err);
    }
  } else if (language === 'python') {
    if (!ruffReady || !ruffWorkspace) {
      console.warn('[Behelith Sandbox] Ruff is not ready yet');
      return;
    }
    try {
      const formatted = ruffWorkspace.format(code);
      if (formatted !== code) {
        editor.setValue(formatted);
        console.log('[Behelith Sandbox] Code formatted using Ruff');
      }
    } catch (err) {
      console.error('[Behelith Sandbox] Ruff error:', err);
    }
  } else {
    console.log('[Behelith Sandbox] Formatting not supported for language:', language);
  }
}

// Initialize Monaco Editor
function parseHotkeyToMonaco(hotkeyStr) {
  if (!hotkeyStr) return 0;
  const parts = hotkeyStr.split('+').map(p => p.trim());
  let mod = 0;
  let code = 0;
  
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl') {
      mod |= monaco.KeyMod.CtrlCmd;
    } else if (lower === 'alt') {
      mod |= monaco.KeyMod.Alt;
    } else if (lower === 'shift') {
      mod |= monaco.KeyMod.Shift;
    } else if (lower === 'cmd' || lower === 'meta') {
      mod |= monaco.KeyMod.CtrlCmd;
    } else {
      const upper = part.toUpperCase();
      if (upper.length === 1) {
        if (upper >= 'A' && upper <= 'Z') {
          code = monaco.KeyCode[`Key${upper}`];
        } else if (upper >= '0' && upper <= '9') {
          code = monaco.KeyCode[`Digit${upper}`];
        } else {
          const charMap = {
            ';': monaco.KeyCode.Semicolon,
            '=': monaco.KeyCode.Equal,
            ',': monaco.KeyCode.Comma,
            '-': monaco.KeyCode.Minus,
            '.': monaco.KeyCode.Period,
            '/': monaco.KeyCode.Slash,
            '`': monaco.KeyCode.Backquote,
            '[': monaco.KeyCode.BracketLeft,
            '\\': monaco.KeyCode.Backslash,
            ']': monaco.KeyCode.BracketRight,
            "'": monaco.KeyCode.Quote
          };
          code = charMap[upper] || 0;
        }
      } else {
        const namedMap = {
          'ENTER': monaco.KeyCode.Enter,
          'ESCAPE': monaco.KeyCode.Escape,
          'ESC': monaco.KeyCode.Escape,
          'SPACE': monaco.KeyCode.Space,
          ' ': monaco.KeyCode.Space,
          'TAB': monaco.KeyCode.Tab,
          'BACKSPACE': monaco.KeyCode.Backspace,
          'DELETE': monaco.KeyCode.Delete,
          'INSERT': monaco.KeyCode.Insert,
          'ARROWUP': monaco.KeyCode.UpArrow,
          'UP': monaco.KeyCode.UpArrow,
          'ARROWDOWN': monaco.KeyCode.DownArrow,
          'DOWN': monaco.KeyCode.DownArrow,
          'ARROWLEFT': monaco.KeyCode.LeftArrow,
          'LEFT': monaco.KeyCode.LeftArrow,
          'ARROWRIGHT': monaco.KeyCode.RightArrow,
          'RIGHT': monaco.KeyCode.RightArrow,
          'HOME': monaco.KeyCode.Home,
          'END': monaco.KeyCode.End,
          'PAGEUP': monaco.KeyCode.PageUp,
          'PAGEDOWN': monaco.KeyCode.PageDown,
          'F1': monaco.KeyCode.F1,
          'F2': monaco.KeyCode.F2,
          'F3': monaco.KeyCode.F3,
          'F4': monaco.KeyCode.F4,
          'F5': monaco.KeyCode.F5,
          'F6': monaco.KeyCode.F6,
          'F7': monaco.KeyCode.F7,
          'F8': monaco.KeyCode.F8,
          'F9': monaco.KeyCode.F9,
          'F10': monaco.KeyCode.F10,
          'F11': monaco.KeyCode.F11,
          'F12': monaco.KeyCode.F12
        };
        code = namedMap[upper] || 0;
      }
    }
  }
  
  if (code === 0) return 0;
  return mod | code;
}

function processCursorPlaceholder(code) {
  let processedCode = code || '';
  let line = 1;
  let column = 1;
  let hasCursor = false;
  
  const cursorIndex = processedCode.indexOf('[cursor]');
  if (cursorIndex !== -1) {
    const beforeCursor = processedCode.substring(0, cursorIndex);
    const lines = beforeCursor.split('\n');
    line = lines.length;
    column = lines[lines.length - 1].length + 1;
    processedCode = processedCode.replace('[cursor]', '');
    hasCursor = true;
  }
  
  return { code: processedCode, line, column, hasCursor };
}

function loadTemplate(tpl) {
  if (!editor) return;
  
  const parsed = processCursorPlaceholder(tpl.code);
  
  editor.setValue(parsed.code);
  
  if (tpl.language && tpl.language !== editor.getModel().getLanguageId()) {
    monaco.editor.setModelLanguage(editor.getModel(), tpl.language);
    window.parent.postMessage({ type: 'BEHELITH_LANGUAGE_CHANGED_BY_TEMPLATE', language: tpl.language }, '*');
  }
  
  editor.setPosition({ lineNumber: parsed.line, column: parsed.column });
  editor.focus();
}

let actionDisposables = [];

function bindEditorKeybindings(settings) {
  for (const disp of actionDisposables) {
    disp.dispose();
  }
  actionDisposables = [];

  if (!editor || !settings) return;

  // 1. Toggle Editor
  if (settings.hotkeyToggleEditor) {
    const key = parseHotkeyToMonaco(settings.hotkeyToggleEditor);
    if (key) {
      const disp = editor.addAction({
        id: 'behelith-action-toggle-editor',
        label: 'Toggle Side Editor',
        keybindings: [key],
        run: function () {
          window.parent.postMessage({ type: 'BEHELITH_ACTION_TOGGLE_EDITOR' }, '*');
          return null;
        }
      });
      actionDisposables.push(disp);
    }
  }

  // 2. Run Code
  if (settings.hotkeyRunCode) {
    const key = parseHotkeyToMonaco(settings.hotkeyRunCode);
    if (key) {
      const disp = editor.addAction({
        id: 'behelith-action-run',
        label: 'Run Local Tests',
        keybindings: [key],
        run: function () {
          window.parent.postMessage({ type: 'BEHELITH_ACTION_RUN' }, '*');
          return null;
        }
      });
      actionDisposables.push(disp);
    }
  }

  // 3. Format Code (Custom hotkey)
  if (settings.hotkeyFormatCode) {
    const key = parseHotkeyToMonaco(settings.hotkeyFormatCode);
    if (key) {
      const disp = editor.addAction({
        id: 'behelith-action-format',
        label: 'Format Code',
        keybindings: [key],
        run: function () {
          formatCode();
          return null;
        }
      });
      actionDisposables.push(disp);
    }
  }

  // 4. Word Wrap
  if (settings.hotkeyWordWrap) {
    const key = parseHotkeyToMonaco(settings.hotkeyWordWrap);
    if (key) {
      const disp = editor.addAction({
        id: 'behelith-action-wordwrap',
        label: 'Toggle Word Wrap',
        keybindings: [key],
        run: function () {
          const isWrapped = editor.getOption(monaco.editor.EditorOption.wordWrap) === 'on';
          editor.updateOptions({ wordWrap: isWrapped ? 'off' : 'on' });
          return null;
        }
      });
      actionDisposables.push(disp);
    }
  }

  // 5. Help Section
  if (settings.hotkeyHelpSection) {
    const key = parseHotkeyToMonaco(settings.hotkeyHelpSection);
    if (key) {
      const disp = editor.addAction({
        id: 'behelith-action-help',
        label: 'Toggle Help Panel',
        keybindings: [key],
        run: function () {
          window.parent.postMessage({ type: 'BEHELITH_ACTION_HELP' }, '*');
          return null;
        }
      });
      actionDisposables.push(disp);
    }
  }

  // 6. Templates
  if (settings.templates && Array.isArray(settings.templates)) {
    settings.templates.forEach(tpl => {
      if (tpl.hotkey) {
        const key = parseHotkeyToMonaco(tpl.hotkey);
        if (key) {
          const disp = editor.addAction({
            id: `behelith-template-${tpl.id}`,
            label: `Load Template: ${tpl.name}`,
            keybindings: [key],
            run: function () {
              loadTemplate(tpl);
              return null;
            }
          });
          actionDisposables.push(disp);
        }
      }
    });
  }
}

function initEditor(initialValue = '', language = 'cpp', settings = null) {
  const container = document.getElementById('editor-container');
  if (!container) return;

  container.innerHTML = '';

  const currentTheme = settings?.editorTheme || 'vs-dark';
  const currentFontSize = settings?.fontSize || 14;
  formatOnSave = settings ? settings.formatOnSave : true;

  const parsed = processCursorPlaceholder(initialValue);

  editor = monaco.editor.create(container, {
    value: parsed.code || '// Write your code here...\n',
    language: language,
    theme: currentTheme,
    automaticLayout: true,
    fontSize: currentFontSize,
    fontFamily: "'Consolas', 'Courier New', monospace",
    minimap: { enabled: true },
    lineNumbers: 'on',
    roundedSelection: true,
    scrollBeyondLastLine: false,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    padding: { top: 10, bottom: 10 },
    scrollbar: {
      vertical: 'visible',
      horizontal: 'visible',
      useShadows: true,
      verticalHasArrows: false,
      horizontalHasArrows: false
    }
  });

  if (parsed.hasCursor) {
    editor.setPosition({ lineNumber: parsed.line, column: parsed.column });
    editor.focus();
  }

  // Bind Ctrl+S / Cmd+S keybinding to format code
  editor.addAction({
    id: 'behelith-format',
    label: 'Format Code (Prettier)',
    keybindings: [
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS
    ],
    precondition: null,
    keybindingContext: null,
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.5,
    run: function (ed) {
      if (formatOnSave) {
        formatCode();
      } else {
        console.log('[Behelith Sandbox] Save intercepted, but auto-formatting is disabled');
      }
      return null;
    }
  });

  if (settings) {
    bindEditorKeybindings(settings);
  }

  // Notify the parent on every keystroke/change
  editor.onDidChangeModelContent(() => {
    const currentCode = editor.getValue();
    window.parent.postMessage({
      type: 'BEHELITH_CODE_CHANGE',
      code: currentCode
    }, '*');
    scheduleDiagnostics();

    // Clear compiler diagnostics on edit
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelMarkers(model, 'behelith_compiler', []);
    }
  });

  // Run diagnostics initially on startup
  runDiagnostics();

  console.log('[Behelith Sandbox] Monaco Editor initialized with language:', language);
}

// Listen for messages from the host (content script)
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;

  switch (message.type) {
    case 'BEHELITH_INIT_CODE':
      initEditor(message.code, message.language, message.settings);
      break;

    case 'BEHELITH_SET_LANGUAGE':
      if (editor) {
        const model = editor.getModel();
        monaco.editor.setModelLanguage(model, message.language);
        monaco.editor.setModelMarkers(model, 'behelith_compiler', []);
        console.log('[Behelith Sandbox] Language changed to:', message.language);
        runDiagnostics();
      }
      break;

    case 'BEHELITH_UPDATE_CODE':
      if (editor) {
        const parsed = processCursorPlaceholder(message.code);
        if (editor.getValue() !== parsed.code) {
          editor.setValue(parsed.code);
          if (parsed.hasCursor) {
            editor.setPosition({ lineNumber: parsed.line, column: parsed.column });
            editor.focus();
          }
        }
      }
      break;

    case 'BEHELITH_UPDATE_SETTINGS':
      if (editor && message.settings) {
        formatOnSave = message.settings.formatOnSave;
        monaco.editor.setTheme(message.settings.editorTheme);
        editor.updateOptions({ fontSize: message.settings.fontSize });
        bindEditorKeybindings(message.settings);
        console.log('[Behelith Sandbox] Applied live settings and keybindings:', message.settings);
      }
      break;

    case 'BEHELITH_LOAD_TEMPLATE':
      if (message.template) {
        loadTemplate(message.template);
      }
      break;

    case 'BEHELITH_TOGGLE_WORD_WRAP':
      if (editor) {
        const isWrapped = editor.getOption(monaco.editor.EditorOption.wordWrap) === 'on';
        editor.updateOptions({ wordWrap: isWrapped ? 'off' : 'on' });
      }
      break;

    case 'BEHELITH_FORMAT_CODE':
      formatCode();
      break;

    case 'BEHELITH_COMPILER_DIAGNOSTICS':
      if (editor) {
        const model = editor.getModel();
        if (model) {
          const lineCount = model.getLineCount();
          const markers = (message.diagnostics || []).map(d => {
            const startLineNumber = Math.max(1, Math.min(d.startLineNumber, lineCount));
            const endLineNumber = Math.max(1, Math.min(d.endLineNumber || d.startLineNumber, lineCount));
            
            const startLineMaxCol = model.getLineMaxColumn(startLineNumber);
            const endLineMaxCol = model.getLineMaxColumn(endLineNumber);
            
            const startColumn = Math.max(1, Math.min(d.startColumn || 1, startLineMaxCol));
            const endColumn = Math.max(1, Math.min(d.endColumn || (startColumn + 1), endLineMaxCol));
            
            return {
              severity: d.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
              message: d.message,
              startLineNumber,
              startColumn,
              endLineNumber,
              endColumn
            };
          });
          monaco.editor.setModelMarkers(model, 'behelith_compiler', markers);
        }
      }
      break;
  }
});

window.addEventListener('wheel', (e) => {
  if (!editor) return;
  const scrollTop = editor.getScrollTop();
  const scrollHeight = editor.getScrollHeight();
  const clientHeight = editor.getLayoutInfo().height;
  const deltaY = e.deltaY;
  
  const isAtTop = scrollTop <= 0;
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;
  const isNotScrollable = scrollHeight <= clientHeight;
  
  if (isNotScrollable || (deltaY < 0 && isAtTop) || (deltaY > 0 && isAtBottom)) {
    window.parent.postMessage({
      type: 'BEHELITH_SCROLL_PARENT',
      deltaY: deltaY
    }, '*');
  }
}, { capture: true, passive: true });

// Notify parent that sandbox is ready
window.parent.postMessage({
  type: 'BEHELITH_SANDBOX_READY'
}, '*');
