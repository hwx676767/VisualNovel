/**
 * Shared AI proxy helpers for Cloudflare Pages Functions.
 */

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/**
 * Optional bearer-token gate for /api/* when SITE_ACCESS_TOKEN is set.
 */
export function assertAuthorized(request, env) {
  const required = env.SITE_ACCESS_TOKEN;
  if (!required) return null;

  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const urlToken = new URL(request.url).searchParams.get('token');
  const token = bearer || urlToken || '';

  if (token !== required) {
    return jsonResponse({ error: '未授权。请登录或提供有效访问令牌。' }, 401);
  }
  return null;
}

export async function proxyChat(request, env) {
  const apiKey = env.AI_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      {
        error:
          '未配置 AI_API_KEY。请在 Cloudflare Pages 项目设置中添加密钥（Settings → Environment variables）。'
      },
      503
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: '请求体必须是 JSON' }, 400);
  }

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse({ error: 'messages 不能为空' }, 400);
  }

  const baseUrl = (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = env.AI_MODEL || 'gpt-4o-mini';

  const payload = {
    model,
    messages,
    temperature: 0.85
  };

  if (env.AI_JSON_MODE !== 'false') {
    payload.response_format = { type: 'json_object' };
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data.error?.message || data.message || 'AI 请求失败';
      return jsonResponse({ error: message }, response.status);
    }

    return jsonResponse(data);
  } catch (error) {
    return jsonResponse({ error: error.message || '服务器内部错误' }, 500);
  }
}

export function aiStatus(env) {
  return jsonResponse({
    configured: Boolean(env.AI_API_KEY),
    model: env.AI_MODEL || 'gpt-4o-mini',
    baseUrl: env.AI_BASE_URL || 'https://api.openai.com/v1',
    authRequired: Boolean(env.SITE_ACCESS_TOKEN)
  });
}
