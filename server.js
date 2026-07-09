/**
 * Local dev server: static files + AI proxy (keeps API key off the browser).
 */
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8765;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

app.get('/api/ai/status', (_req, res) => {
  res.json({
    configured: Boolean(process.env.AI_API_KEY),
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1'
  });
});

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: '未配置 AI_API_KEY。请复制 .env.example 为 .env 并填入密钥，然后重启服务器。'
    });
  }

  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 不能为空' });
  }

  try {
    const payload = {
      model,
      messages,
      temperature: 0.85
    };

    // OpenAI-compatible JSON mode (optional; falls back if provider rejects)
    if (process.env.AI_JSON_MODE !== 'false') {
      payload.response_format = { type: 'json_object' };
    }

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
      return res.status(response.status).json({ error: message });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || '服务器内部错误' });
  }
});

app.listen(PORT, () => {
  const configured = Boolean(process.env.AI_API_KEY);
  console.log(`Visual Novel → http://localhost:${PORT}`);
  console.log(configured ? `AI proxy ready (${process.env.AI_MODEL || 'gpt-4o-mini'})` : 'AI proxy: AI_API_KEY not set (.env)');
});
