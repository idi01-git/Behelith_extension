// Behelith Background Service Worker
console.log('[Behelith] Background service worker loaded');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Behelith] Extension installed successfully!');
});

// Track active AbortControllers per tabId
const activeRequests = new Map();

function toBase64(str) {
  const bytes = new TextEncoder().encode(str || '');
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(str) {
  if (!str) return '';
  try {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return str;
  }
}

// Cloud Sandbox compilation fallback using Judge0 CE API
async function runCloudSandbox(message, tabId) {
  const code = (message.code || '').replace(/\u00a0/g, ' ');
  const language = message.language === 'cpp' ? 'cpp' : 'python';
  const inputs = message.inputs || [];

  const controllers = [];
  activeRequests.set(tabId, controllers);

  try {
    const promises = inputs.map(async (testInput) => {
      const controller = new AbortController();
      controllers.push(controller);

      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second timeout

      try {
        const response = await fetch('https://ce.judge0.com/submissions?base64_encoded=true&wait=true', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            source_code: toBase64(code),
            language_id: language === 'cpp' ? 54 : 100, // 54 for GCC 9.2.0 (faster compile time), 100 for Python 3.12.5
            stdin: toBase64(testInput || '')
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Status ${response.status}`);
        }

        const data = await response.json();

        // Remove controller from list
        const idx = controllers.indexOf(controller);
        if (idx !== -1) controllers.splice(idx, 1);

        // Check for compilation error (status ID 6 in Judge0)
        if (data.status && data.status.id === 6) {
          return {
            compileError: true,
            output: fromBase64(data.compile_output || '')
          };
        }

        // Check for timeout error (status ID 5 in Judge0)
        if (data.status && data.status.id === 5) {
          return {
            status: 'timeout',
            stdout: '',
            stderr: 'Result: TLE (Time Limit Exceeded - 5.0s)',
            time_ms: 5000
          };
        }

        // If status ID is not 3 (Accepted), treat as runtime error
        let status = 'success';
        if (data.status && data.status.id !== 3) {
          status = 'runtime_error';
        }

        const stderr = fromBase64(data.stderr || '');
        return {
          status: status,
          stdout: fromBase64(data.stdout || ''),
          stderr: stderr || (status === 'runtime_error' ? (data.message || 'Runtime Error') : ''),
          time_ms: data.time ? Math.round(parseFloat(data.time) * 1000) : 0
        };
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        // Remove controller from list
        const idx = controllers.indexOf(controller);
        if (idx !== -1) controllers.splice(idx, 1);

        if (fetchErr.name === 'AbortError') {
          return {
            status: 'timeout',
            stdout: '',
            stderr: 'Result: TLE (Time Limit Exceeded - 5.0s) or cancelled by user',
            time_ms: 5000
          };
        }
        throw fetchErr;
      }
    });

    const results = await Promise.all(promises);
    
    // Clean up map
    activeRequests.delete(tabId);

    // If any promise returned a compile error, forward compile_error
    const firstCompileError = results.find(r => r.compileError);
    if (firstCompileError) {
      const compileOutput = firstCompileError.output || '';
      const diagnostics = parseDiagnostics(compileOutput, language);
      chrome.tabs.sendMessage(tabId, {
        type: 'BEHELITH_RUN_RESULT',
        status: 'compile_error',
        output: `Compilation Error (Cloud Sandbox):\n${compileOutput}`,
        diagnostics: diagnostics
      });
      return;
    }

    // Process results to look for runtime errors/tracebacks
    let diagnostics = [];
    results.forEach(res => {
      if (res.status === 'runtime_error' && res.stderr) {
        const errors = parseDiagnostics(res.stderr, language);
        diagnostics.push(...errors);
      }
    });
    // Deduplicate
    const uniqueDiagnostics = [];
    const seen = new Set();
    for (const d of diagnostics) {
      const key = `${d.startLineNumber}:${d.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueDiagnostics.push(d);
      }
    }

    // Return success response to the injectors
    chrome.tabs.sendMessage(tabId, {
      type: 'BEHELITH_RUN_RESULT',
      status: 'success',
      diagnostics: uniqueDiagnostics,
      data: {
        status: 'success',
        compiler_info: 'Compiler: Cloud Sandbox (Judge0 CE)',
        results: results
      }
    });

  } catch (err) {
    activeRequests.delete(tabId);
    chrome.tabs.sendMessage(tabId, {
      type: 'BEHELITH_RUN_RESULT',
      status: 'error',
      output: `Cloud Sandbox Execution Failed.\nDetails: ${err.message}\n\nPlease verify your internet connection or install local compiler for offline use.`
    });
  }
}

// Listen for compilation/run requests from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BEHELITH_CANCEL_RUN') {
    const tabId = sender?.tab?.id;
    if (tabId) {
      const controllers = activeRequests.get(tabId);
      if (controllers) {
        controllers.forEach(c => {
          try {
            c.abort();
          } catch (e) {}
        });
        activeRequests.delete(tabId);
        console.log('[Behelith Background] Cancelled active cloud run for tab:', tabId);
      }
    }
  } else if (message.type === 'BEHELITH_RUN_CODE') {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      console.warn('[Behelith Background] Run requested but no sender tab found');
      return;
    }

    console.log('[Behelith Background] Initiating code execution for tab:', tabId);

    const runEnv = message.runEnv || 'auto';

    if (runEnv === 'cloud') {
      runCloudSandbox(message, tabId);
      return;
    }

    let hasReceivedResponse = false;

    try {
      // Connect to the com.behelith.compiler native messaging host
      const port = chrome.runtime.connectNative('com.behelith.compiler');

      // Post code, inputs, and custom compiler settings to the daemon
      port.postMessage({
        type: 'run',
        code: message.code,
        language: message.language,
        inputs: message.inputs,
        cpp_version: message.cppVersion || 'c++17',
        cpp_opt: message.cppOptLevel || '-O0'
      });

      // Listen for responses from the daemon
      port.onMessage.addListener((response) => {
        hasReceivedResponse = true;
        console.log('[Behelith Background] Received response from local daemon');

        let diagnostics = [];
        if (response.status === 'compile_error') {
          diagnostics = parseDiagnostics(response.output || '', message.language);
        } else if (response.results && Array.isArray(response.results)) {
          response.results.forEach(res => {
            if (res.status === 'runtime_error' && res.stderr) {
              const errors = parseDiagnostics(res.stderr, message.language);
              diagnostics.push(...errors);
            }
          });
          // Deduplicate
          const unique = [];
          const seen = new Set();
          for (const d of diagnostics) {
            const key = `${d.startLineNumber}:${d.message}`;
            if (!seen.has(key)) {
              seen.add(key);
              unique.push(d);
            }
          }
          diagnostics = unique;
        }

        // Forward the compilation/run results to the content script
        chrome.tabs.sendMessage(tabId, {
          type: 'BEHELITH_RUN_RESULT',
          status: response.status || 'success',
          output: response.output || '',
          diagnostics: diagnostics,
          data: response
        });

        // Disconnect port
        port.disconnect();
      });

      // Handle connection errors & fallbacks
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (error && !hasReceivedResponse) {
          if (runEnv === 'auto') {
            console.warn('[Behelith Background] Local daemon not detected. Falling back to Cloud Sandbox...');
            runCloudSandbox(message, tabId);
          } else {
            chrome.tabs.sendMessage(tabId, {
              type: 'BEHELITH_RUN_RESULT',
              status: 'error',
              output: `Local daemon execution failed.\nReason: Local daemon not detected or registry host com.behelith.compiler not registered.\n\nPlease start your daemon or switch Run Environment to Cloud Sandbox in Settings.`
            });
          }
        }
      });

    } catch (e) {
      console.error('[Behelith Background] Native messaging connection exception.', e);
      if (runEnv === 'auto') {
        runCloudSandbox(message, tabId);
      } else {
        chrome.tabs.sendMessage(tabId, {
          type: 'BEHELITH_RUN_RESULT',
          status: 'error',
          output: `Local daemon execution failed.\nError: ${e.message}\n\nPlease start your daemon or switch Run Environment to Cloud Sandbox in Settings.`
        });
      }
    }
  }
});

// Parse compiler errors (C++) and runtime tracebacks (Python) into a structured format
function parseDiagnostics(output, language) {
  if (!output) return [];
  const diagnostics = [];

  if (language === 'cpp') {
    const cppRegex = /(?:^|\n)(?:[a-zA-Z]:[\\/])?[^:\n]*\.?(?:cpp|c|cc|cxx|h|hpp):(\d+):(?:(\d+):)?\s*(error|warning|fatal error|note):\s*([^\n]+)/gi;
    let match;
    while ((match = cppRegex.exec(output)) !== null) {
      const line = parseInt(match[1], 10);
      const col = match[2] ? parseInt(match[2], 10) : 1;
      const rawSeverity = match[3].toLowerCase();
      const severity = (rawSeverity === 'warning' || rawSeverity === 'note') ? 'warning' : 'error';
      const message = match[4].trim();

      diagnostics.push({
        startLineNumber: line,
        startColumn: col,
        endLineNumber: line,
        endColumn: col + 1,
        message: message,
        severity: severity
      });
    }
  } else if (language === 'python') {
    const pyRegex = /File "[^"]*(?:solution|script)\.py", line (\d+)/gi;
    let match;
    let lastMatch = null;
    while ((match = pyRegex.exec(output)) !== null) {
      lastMatch = match;
    }

    if (lastMatch) {
      const line = parseInt(lastMatch[1], 10);
      const lines = output.trim().split('\n');
      let message = 'Runtime Error';
      if (lines.length > 0) {
        for (let i = lines.length - 1; i >= 0; i--) {
          const l = lines[i].trim();
          if (l && !l.startsWith('File "') && !l.startsWith('^') && !l.includes('line ') && l.indexOf('  ') !== 0) {
            message = l;
            break;
          }
        }
      }

      diagnostics.push({
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: 100, // Underline the rest of the line
        message: message,
        severity: 'error'
      });
    }
  }

  return diagnostics;
}
