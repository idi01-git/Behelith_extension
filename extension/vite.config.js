import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false, // Disable minification for easier debugging of the extension
    rollupOptions: {
      input: {
        editor: resolve(__dirname, 'sandbox/editor.html'),
        background: resolve(__dirname, 'background.js'),
        cf_injector: resolve(__dirname, 'content/cf_injector.js'),
        // cc_injector: resolve(__dirname, 'content/cc_injector.js')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          if (chunkInfo.name === 'cf_injector') {
            return 'content/cf_injector.js';
          }
          // if (chunkInfo.name === 'cc_injector') {
          //   return 'content/cc_injector.js';
          // }
          return 'assets/[name].js';
        },
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) => {
          return 'assets/[name][extname]';
        }
      }
    }
  },
  plugins: [
    {
      name: 'copy-extension-assets',
      closeBundle() {
        const distContentDir = resolve(__dirname, 'dist/content');
        if (!fs.existsSync(distContentDir)) {
          fs.mkdirSync(distContentDir, { recursive: true });
        }
        const distSandboxDir = resolve(__dirname, 'dist/sandbox');
        if (!fs.existsSync(distSandboxDir)) {
          fs.mkdirSync(distSandboxDir, { recursive: true });
        }
        
        // Copy manifest.json
        fs.copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(__dirname, 'dist/manifest.json')
        );
        // Copy hud.css
        fs.copyFileSync(
          resolve(__dirname, 'content/hud.css'),
          resolve(__dirname, 'dist/content/hud.css')
        );
        // Copy clang-format.wasm
        fs.copyFileSync(
          resolve(__dirname, 'sandbox/clang-format.wasm'),
          resolve(__dirname, 'dist/sandbox/clang-format.wasm')
        );
        // Copy ruff.wasm
        fs.copyFileSync(
          resolve(__dirname, 'sandbox/ruff.wasm'),
          resolve(__dirname, 'dist/sandbox/ruff.wasm')
        );
        // Remove crossorigin attributes from editor.html to fix Chrome Extension CORS issues
        const distEditorHtmlPath = resolve(__dirname, 'dist/sandbox/editor.html');
        if (fs.existsSync(distEditorHtmlPath)) {
          let html = fs.readFileSync(distEditorHtmlPath, 'utf8');
          html = html.replace(/ crossorigin/g, '');
          fs.writeFileSync(distEditorHtmlPath, html);
          console.log('[Copy Plugin] Removed crossorigin attributes from editor.html');
        }

        console.log('[Copy Plugin] Copied manifest.json, content/hud.css, and WASM files to dist/');
      }
    }
  ]
});
