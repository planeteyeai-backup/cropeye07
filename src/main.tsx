import React from 'react';
import ReactDOM from 'react-dom/client';
import AppWrapper from './components/AppWrapper';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';

function showBootstrapError(message: string) {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;">
      <div style="max-width:560px;width:100%;border:1px solid #fecaca;background:#fff;border-radius:16px;padding:24px;box-shadow:0 10px 25px rgba(0,0,0,.08);">
        <h1 style="margin:0 0 8px;font-size:18px;color:#0f172a;">App failed to load</h1>
        <p style="margin:0 0 12px;font-size:14px;color:#475569;">Refresh the page. If this keeps happening, clear site data and sign in again.</p>
        <pre style="margin:0;max-height:180px;overflow:auto;background:#fef2f2;color:#991b1b;padding:12px;border-radius:8px;font-size:12px;white-space:pre-wrap;">${message}</pre>
      </div>
    </div>
  `;
}

window.addEventListener('error', (event) => {
  console.error('[bootstrap error]', event.error ?? event.message);
  if (!document.getElementById('root')?.hasChildNodes()) {
    showBootstrapError(String(event.error?.message ?? event.message));
  }
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[bootstrap unhandledrejection]', event.reason);
});

const rootEl = document.getElementById('root') as HTMLElement;

try {
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <AppErrorBoundary>
      <AppWrapper />
    </AppErrorBoundary>
  );
} catch (error) {
  console.error('[main.tsx render failed]', error);
  showBootstrapError(error instanceof Error ? error.message : String(error));
}