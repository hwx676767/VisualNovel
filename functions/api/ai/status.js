import { assertAuthorized, aiStatus, corsHeaders, jsonResponse } from '../../_lib/ai.js';

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '*';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestGet(context) {
  const denied = assertAuthorized(context.request, context.env);
  if (denied) return denied;
  return aiStatus(context.env);
}

export async function onRequest(context) {
  return jsonResponse({ error: 'Use GET' }, 405);
}
