/**
 * xvpn Cloudflare Worker
 *
 * This worker acts as an authenticated proxy service that:
 * 1. Validates Auth0 JWT tokens
 * 2. Proxies HTTP/HTTPS requests
 * 3. Enforces rate limiting
 * 4. Logs audit events
 */

import { jwtVerify, createRemoteJWKSet } from 'jose';

// CORS headers helper
const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Target-URL',
  'Access-Control-Max-Age': '86400',
});

// Rate limiting using KV
async function checkRateLimit(env, userId) {
  const key = `ratelimit:${userId}`;
  const now = Date.now();
  const windowMs = parseInt(env.RATE_LIMIT_WINDOW_MS || '60000', 10);
  const maxRequests = parseInt(env.RATE_LIMIT_MAX_REQUESTS || '100', 10);

  // Get current count
  const data = await env.RATE_LIMIT.get(key, { type: 'json' });

  if (!data) {
    // First request in window
    await env.RATE_LIMIT.put(key, JSON.stringify({ count: 1, resetAt: now + windowMs }), {
      expirationTtl: Math.ceil(windowMs / 1000),
    });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  // Check if window expired
  if (now > data.resetAt) {
    await env.RATE_LIMIT.put(key, JSON.stringify({ count: 1, resetAt: now + windowMs }), {
      expirationTtl: Math.ceil(windowMs / 1000),
    });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  // Increment count
  if (data.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: data.resetAt };
  }

  data.count += 1;
  await env.RATE_LIMIT.put(key, JSON.stringify(data), {
    expirationTtl: Math.ceil((data.resetAt - now) / 1000),
  });

  return { allowed: true, remaining: maxRequests - data.count };
}

// JWT verification
async function verifyToken(token, env) {
  try {
    const JWKS = createRemoteJWKSet(new URL(`https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`));

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${env.AUTH0_DOMAIN}/`,
      audience: env.AUTH0_AUDIENCE,
    });

    return { valid: true, userId: payload.sub, payload };
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    return { valid: false, error: error.message };
  }
}

// Check if domain is allowed
function isDomainAllowed(url, allowedDomains) {
  if (!allowedDomains) return true; // Allow all if not configured

  const domains = allowedDomains.split(',').map(d => d.trim());
  const urlObj = new URL(url);
  const hostname = urlObj.hostname;

  return domains.some(domain => {
    if (domain.startsWith('*.')) {
      const baseDomain = domain.slice(2);
      return hostname.endsWith(baseDomain) || hostname === baseDomain;
    }
    return hostname === domain;
  });
}

// Audit logging
async function logAuditEvent(env, event) {
  try {
    const key = `audit:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    await env.AUDIT_LOG.put(key, JSON.stringify(event), {
      expirationTtl: 30 * 24 * 60 * 60, // 30 days
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

// Main proxy handler
async function handleProxyRequest(request, env, userId) {
  const targetUrl = request.headers.get('X-Target-URL');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'X-Target-URL header is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate target URL
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid target URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if domain is allowed
  if (!isDomainAllowed(targetUrl, env.ALLOWED_PROXY_DOMAINS)) {
    await logAuditEvent(env, {
      type: 'proxy_blocked',
      userId,
      targetUrl,
      reason: 'domain_not_allowed',
      timestamp: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Log proxy request
  await logAuditEvent(env, {
    type: 'proxy_request',
    userId,
    targetUrl,
    method: request.method,
    timestamp: new Date().toISOString(),
  });

  try {
    // Forward request
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.delete('X-Target-URL');
    proxyHeaders.delete('Authorization');
    proxyHeaders.set('User-Agent', 'xvpn-proxy/1.0');

    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'follow',
    });

    const response = await fetch(proxyRequest);

    // Clone response and modify headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('X-Proxied-By', 'xvpn');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy request failed:', error);

    await logAuditEvent(env, {
      type: 'proxy_error',
      userId,
      targetUrl,
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ error: 'Proxy request failed', details: error.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Main request handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // API info endpoint
    if (url.pathname === '/' || url.pathname === '/api') {
      return new Response(JSON.stringify({
        name: 'xvpn-worker',
        version: '1.0.0',
        endpoints: {
          health: '/health',
          proxy: '/proxy',
          session: '/session',
        },
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // All other endpoints require authentication
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const token = authHeader.substring(7);
    const verification = await verifyToken(token, env);

    if (!verification.valid) {
      return new Response(JSON.stringify({ error: 'Invalid token', details: verification.error }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const userId = verification.userId;

    // Check rate limit
    const rateLimitResult = await checkRateLimit(env, userId);
    if (!rateLimitResult.allowed) {
      return new Response(JSON.stringify({
        error: 'Rate limit exceeded',
        resetAt: new Date(rateLimitResult.resetAt).toISOString(),
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': rateLimitResult.resetAt.toString(),
          ...corsHeaders(origin),
        },
      });
    }

    // Session info endpoint
    if (url.pathname === '/session') {
      return new Response(JSON.stringify({
        userId: verification.userId,
        email: verification.payload.email,
        emailVerified: verification.payload.email_verified,
        rateLimit: {
          remaining: rateLimitResult.remaining,
        },
      }), {
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          ...corsHeaders(origin),
        },
      });
    }

    // Proxy endpoint
    if (url.pathname === '/proxy') {
      const response = await handleProxyRequest(request, env, userId);
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders(origin)).forEach(([key, value]) => {
        headers.set(key, value);
      });
      headers.set('X-RateLimit-Remaining', rateLimitResult.remaining.toString());

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    // 404 for unknown endpoints
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};
