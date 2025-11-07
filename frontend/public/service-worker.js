/**
 * xvpn Service Worker
 *
 * This service worker intercepts HTTP/HTTPS requests and proxies them
 * through the Cloudflare Worker backend when proxy mode is enabled.
 */

let proxyEnabled = false;
let workerUrl = '';
let authToken = '';

// Listen for messages from the main app
self.addEventListener('message', (event) => {
  if (event.data.type === 'ENABLE_PROXY') {
    proxyEnabled = true;
    workerUrl = event.data.workerUrl;
    authToken = event.data.token;
    console.log('[Service Worker] Proxy enabled');

    // Notify the client
    event.ports[0]?.postMessage({ success: true });
  } else if (event.data.type === 'DISABLE_PROXY') {
    proxyEnabled = false;
    authToken = '';
    console.log('[Service Worker] Proxy disabled');

    // Notify the client
    event.ports[0]?.postMessage({ success: true });
  }
});

// Install event
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(self.clients.claim());
});

// Fetch event - intercept and proxy requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Don't intercept requests to our own origin or the worker
  if (url.origin === self.location.origin || url.origin === workerUrl) {
    return;
  }

  // Don't intercept browser extensions or chrome:// URLs
  if (url.protocol === 'chrome-extension:' || url.protocol === 'chrome:') {
    return;
  }

  // Only intercept HTTP/HTTPS
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // If proxy is not enabled, let the request pass through
  if (!proxyEnabled || !authToken || !workerUrl) {
    return;
  }

  // Intercept and proxy the request
  event.respondWith(proxyRequest(event.request));
});

/**
 * Proxy a request through the Cloudflare Worker
 */
async function proxyRequest(request) {
  const targetUrl = request.url;

  console.log('[Service Worker] Proxying request:', targetUrl);

  try {
    const proxyResponse = await fetch(`${workerUrl}/proxy`, {
      method: request.method,
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'X-Target-URL': targetUrl,
        'Content-Type': request.headers.get('Content-Type') || '',
      },
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    // If proxy request failed, return error
    if (!proxyResponse.ok) {
      console.error('[Service Worker] Proxy request failed:', proxyResponse.status);

      // If unauthorized, disable proxy
      if (proxyResponse.status === 401) {
        proxyEnabled = false;
        authToken = '';
        console.log('[Service Worker] Authentication failed, proxy disabled');
      }

      // Return a user-friendly error page
      return new Response(
        createErrorPage(proxyResponse.status, targetUrl),
        {
          status: proxyResponse.status,
          statusText: proxyResponse.statusText,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }
      );
    }

    // Return the proxied response
    return proxyResponse;
  } catch (error) {
    console.error('[Service Worker] Proxy error:', error);

    return new Response(
      createErrorPage(500, targetUrl, error.message),
      {
        status: 500,
        statusText: 'Proxy Error',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
}

/**
 * Create a user-friendly error page
 */
function createErrorPage(status, targetUrl, errorMessage = '') {
  return `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>xvpn - プロキシエラー</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }

    .error-container {
      background: white;
      border-radius: 12px;
      padding: 3rem;
      max-width: 600px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
    }

    .error-icon {
      font-size: 4rem;
      color: #ef4444;
      margin-bottom: 1rem;
    }

    h1 {
      color: #1f2937;
      margin-bottom: 1rem;
      font-size: 2rem;
    }

    .error-code {
      color: #6b7280;
      font-size: 1.125rem;
      margin-bottom: 2rem;
    }

    .error-details {
      background: #f9fafb;
      border-left: 4px solid #ef4444;
      padding: 1rem;
      text-align: left;
      margin-bottom: 2rem;
      border-radius: 4px;
    }

    .error-details p {
      margin-bottom: 0.5rem;
      color: #374151;
    }

    .error-details code {
      background: #e5e7eb;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.875rem;
      word-break: break-all;
    }

    .actions {
      display: flex;
      gap: 1rem;
      justify-content: center;
    }

    button {
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      transition: transform 0.2s;
    }

    button:hover {
      transform: translateY(-2px);
    }

    .btn-primary {
      background: #667eea;
      color: white;
    }

    .btn-secondary {
      background: #e5e7eb;
      color: #374151;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-icon">⚠️</div>
    <h1>プロキシエラー</h1>
    <p class="error-code">エラーコード: ${status}</p>

    <div class="error-details">
      <p><strong>リクエストURL:</strong></p>
      <p><code>${targetUrl}</code></p>
      ${errorMessage ? `<p style="margin-top: 1rem;"><strong>エラー詳細:</strong> ${errorMessage}</p>` : ''}
    </div>

    <div class="actions">
      <button class="btn-primary" onclick="window.history.back()">戻る</button>
      <button class="btn-secondary" onclick="window.location.href='/'">ホームへ</button>
    </div>
  </div>
</body>
</html>
  `;
}

console.log('[Service Worker] Loaded');
