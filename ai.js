/**
 * AI dialogue module — builds prompts and calls /api/chat proxy.
 */
const AI = (() => {
  let directorPrompt = null;

  async function loadDirectorPrompt() {
    if (directorPrompt) return directorPrompt;
    const response = await fetch('data/prompts/director.json');
    if (!response.ok) throw new Error('无法加载 director.json');
    directorPrompt = await response.json();
    return directorPrompt;
  }

  /**
   * @returns {Promise<{configured: boolean, model: string, baseUrl: string}>}
   */
  async function getStatus() {
    const response = await VNAuth.apiFetch('/api/ai/status');
    if (!response.ok) throw new Error('无法连接 AI 服务');
    return response.json();
  }

  /**
   * Builds the system prompt from director rules + character profiles + game state.
   */
  function buildSystemPrompt(context) {
    const { director, characters, gameState, scene, background, interactive, isDecisive = false } = context;

    const npcLines = characters
      .filter((c) => c.role === 'npc' && c.aiProfile)
      .map((c) => {
        const conviction = gameState.conviction[c.id] ?? 0;
        const stage = pickConvictionStage(c.convictionStages, conviction);
        const samples = pickSpeechSamples(c.speechCorpus, conviction);
        const sampleBlock = samples.length
          ? `语气参考（模仿口吻与节奏，勿整句照抄）：\n${samples.map((s) => `- 「${s}」`).join('\n')}`
          : '';
        return [
          `【${c.displayName} / id:${c.id}】`,
          `性格：${c.aiProfile.personality}`,
          `说话风格：${c.aiProfile.speechStyle}`,
          `心结：${c.knot || '无'}`,
          `当前坚定值：${conviction}（${stage}）`,
          `可用表情：${c.expressions.join(', ')}`,
          sampleBlock
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');

    const beatSection = interactive
      ? [
          '',
          '## 当前节拍（必须遵守）',
          interactive.objective,
          `玩家提示：${interactive.playerPrompt}`,
          `导演目标：${interactive.aiGoal}`,
          `已自由对话 ${gameState.interactiveReplyCount || 0} / ${interactive.maxFreeReplies} 轮`,
          isDecisive
            ? '【重要】玩家刚刚做出了明确决策（快捷行动）。请回应这个决定，然后必须 advanceMainline: true，不要再追问或展开闲聊。'
            : gameState.interactiveReplyCount >= interactive.maxFreeReplies - 1
              ? '【重要】下一轮或本轮必须 advanceMainline: true，把故事推向主线。'
              : ''
        ].join('\n')
      : '';

    return [
      '你是这款视觉小说的 AI 叙事导演。',
      '',
      '## 世界观',
      director.world,
      '',
      '## 基调',
      director.tone,
      '',
      '## 叙事层级',
      director.layers,
      '',
      '## 规则',
      ...director.rules.map((r, i) => `${i + 1}. ${r}`),
      '',
      '## 当前游戏状态',
      `场景：${scene?.id || 'unknown'} — ${scene?.speakerName || ''}`,
      `背景：${background?.displayName || gameState.currentBackground} — ${background?.description || ''}`,
      `第 ${gameState.day} 天`,
      `抗生素：${gameState.resources.antibiotics}，汽油：${gameState.resources.gasoline}`,
      `不认真阈值：${gameState.seriousnessThreshold}`,
      '',
      '## 角色档案',
      npcLines || '（角色档案待补充）',
      beatSection,
      '',
      '## 输出格式',
      '只输出一个 JSON 对象，不要 markdown，不要代码块。字段：',
      JSON.stringify(director.responseSchema, null, 2)
    ].join('\n');
  }

  function pickConvictionStage(stages, value) {
    if (!stages) return '未知';
    const thresholds = Object.keys(stages)
      .map(Number)
      .sort((a, b) => b - a);
    for (const t of thresholds) {
      if (value >= t) return stages[String(t)];
    }
    return stages['0'] || '未知';
  }

  /**
   * Picks general + current-stage speech samples for AI to mimic.
   */
  function pickSpeechSamples(corpus, conviction) {
    if (!corpus) return [];
    const general = Array.isArray(corpus.general) ? corpus.general : [];
    const byStage = corpus.byConviction || {};
    const thresholds = Object.keys(byStage)
      .map(Number)
      .sort((a, b) => b - a);
    let stageSamples = [];
    for (const t of thresholds) {
      if (conviction >= t) {
        stageSamples = Array.isArray(byStage[String(t)]) ? byStage[String(t)] : [];
        break;
      }
    }
    return [...stageSamples, ...general].filter(Boolean).slice(0, 6);
  }

  /**
   * Builds API history, avoiding duplicate trailing player message.
   */
  function buildHistoryMessages(history, currentPlayerText, limit = 12) {
    let slice = history.slice(-limit);

    const last = slice[slice.length - 1];
    if (last?.role === 'player' && last.text === currentPlayerText) {
      slice = slice.slice(0, -1);
    }

    return slice.map((entry) => {
      if (entry.role === 'player') {
        return { role: 'user', content: entry.text };
      }
      const name = entry.text?.name || 'NPC';
      const text = entry.text?.text || '';
      return { role: 'assistant', content: `[${name}] ${text}` };
    });
  }

  function normalizeForCompare(text) {
    return (text || '').trim().replace(/\s+/g, '');
  }

  function isEchoOfPlayer(npcText, playerText) {
    const a = normalizeForCompare(npcText);
    const b = normalizeForCompare(playerText);
    if (!a || !b) return false;
    return a === b || (a.length >= 8 && b.includes(a)) || (b.length >= 8 && a.includes(b));
  }

  function buildFallbackReply(fallbackSpeaker, playerText, isDecisive) {
    const snippets = [
      `……我听到了。${isDecisive ? '就按你说的办。' : '让我想想。'}`,
      '林檎看了你一眼，没有立刻回答。',
      '闲没有说话，只是把相机握得更紧了一些。'
    ];
    const hash = normalizeForCompare(playerText).length % snippets.length;
    return {
      speakerId: fallbackSpeaker.id,
      speakerName: fallbackSpeaker.displayName,
      expression: fallbackSpeaker.expressions?.[0] || 'neutral',
      text: snippets[hash],
      convictionDelta: {},
      seriousnessDelta: 0,
      advanceMainline: Boolean(isDecisive)
    };
  }

  function parseResponse(rawContent, fallbackSpeaker, playerText, isDecisive = false) {
    let parsed = null;

    try {
      parsed = JSON.parse(rawContent);
    } catch {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = null;
        }
      }
    }

    if (!parsed || typeof parsed.text !== 'string' || !parsed.text.trim()) {
      return buildFallbackReply(fallbackSpeaker, playerText, isDecisive);
    }

    const replyText = parsed.text.trim();

    if (isEchoOfPlayer(replyText, playerText)) {
      console.warn('[AI] Blocked echo of player input, using fallback');
      return buildFallbackReply(fallbackSpeaker, playerText, isDecisive);
    }

    return {
      speakerId: parsed.speakerId || fallbackSpeaker.id,
      speakerName: parsed.speakerName || fallbackSpeaker.displayName,
      expression: parsed.expression || 'neutral',
      text: replyText,
      convictionDelta: parsed.convictionDelta || {},
      seriousnessDelta: Number(parsed.seriousnessDelta) || 0,
      advanceMainline: Boolean(parsed.advanceMainline)
    };
  }

  /**
   * @param {string} playerText
   * @param {object} context
   */
  async function sendPlayerMessage(playerText, context) {
    const director = await loadDirectorPrompt();
    const { charactersData, gameState, storyScenes, storySceneIndex, backgroundsData, dialogueHistory, isDecisive = false } =
      context;

    const characters = Object.values(charactersData);
    const scene = storyScenes[storySceneIndex];
    const background = backgroundsData[gameState.currentBackground];
    const interactive = scene?.interactive || gameState.currentInteractive;

    const fallbackSpeaker =
      charactersData[scene?.character] ||
      charactersData.ringo ||
      charactersData.xian;

    const messages = [
      {
        role: 'system',
        content: buildSystemPrompt({ director, characters, gameState, scene, background, interactive, isDecisive })
      },
      ...buildHistoryMessages(dialogueHistory, playerText),
      { role: 'user', content: playerText }
    ];

    const response = await VNAuth.apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `AI 请求失败 (${response.status})`);
    }

    const rawContent = data.choices?.[0]?.message?.content || '';
    return parseResponse(rawContent, fallbackSpeaker, playerText, isDecisive);
  }

  return { getStatus, sendPlayerMessage };
})();
