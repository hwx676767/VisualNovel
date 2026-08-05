import { assertAuthorized, corsHeaders, jsonResponse, proxyChat } from '../_lib/ai.js';

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '*';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost(context) {
  const denied = assertAuthorized(context.request, context.env);
  if (denied) return denied;
  return proxyChat(context.request, context.env);
}

export async function onRequest(context) {
  return jsonResponse({ error: 'Use POST' }, 405);
}
