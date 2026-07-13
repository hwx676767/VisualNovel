/**
 * Pages middleware — optional site-wide access gate.
 * When SITE_ACCESS_TOKEN is set, visitors must visit /login.html once
 * (token stored in sessionStorage) or pass ?token= on the URL.
 */
import { assertAuthorized } from './_lib/ai.js';

const PUBLIC_PATHS = new Set([
  '/login.html',
  '/favicon.ico'
]);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (!env.SITE_ACCESS_TOKEN) {
    return next();
  }

  if (PUBLIC_PATHS.has(url.pathname)) {
    return next();
  }

  if (url.pathname.startsWith('/api/')) {
    const denied = assertAuthorized(request, env);
    if (denied) return denied;
    return next();
  }

  const urlToken = url.searchParams.get('token');
  if (urlToken === env.SITE_ACCESS_TOKEN) {
    return next();
  }

  const referer = request.headers.get('Referer') || '';
  if (referer.includes('token=')) {
    return next();
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return Response.redirect(new URL('/login.html', url.origin), 302);
  }

  return next();
}
