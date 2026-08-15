/**
 * AI dialogue module — builds prompts and calls /api/chat proxy.
 */
const AI = (() => {
  let directorPrompt = null;
  let actingExamples = null;

  async function loadDirectorPrompt() {
    if (directorPrompt) return directorPrompt;
    const response = await fetch('data/prompts/director.json');
    if (!response.ok) throw new Error('Failed to load director.json');
    directorPrompt = await response.json();
    return directorPrompt;
  }

  async function loadActingExamples() {
    if (actingExamples) return actingExamples;
    try {
      const response = await fetch('data/prompts/acting_examples.json');
      if (!response.ok) return null;
      actingExamples = await response.json();
      return actingExamples;
    } catch {
      return null;
    }
  }

  /**
   * @returns {Promise<{configured: boolean, model: string, baseUrl: string}>}
   */
  async function getStatus() {
    const response = await VNAuth.apiFetch('/api/ai/status');
    if (!response.ok) throw new Error('Cannot reach AI service');
    return response.json();
  }

  /**
   * Builds the system prompt from director rules + character profiles + game state.
   */
  function buildSystemPrompt(context) {
    const {
      director,
      characters,
      gameState,
      scene,
      background,
      interactive,
      isDecisive = false,
      acting
    } = context;

    const npcLines = characters
      .filter((c) => c.role === 'npc' && c.aiProfile)
      .map((c) => {
        const conviction = gameState.conviction[c.id] ?? 0;
        const stage = pickConvictionStage(c.convictionStages, conviction);
        const samples = pickSpeechSamples(c.speechCorpus, conviction);
        const sampleBlock = samples.length
          ? `Voice reference (match tone and rhythm; do NOT copy whole lines):\n${samples.map((s) => `- "${s}"`).join('\n')}`
          : '';
        const actingNote = c.aiProfile.actingNotes
          ? `Acting notes: ${c.aiProfile.actingNotes}`
          : '';
        const styleExamples = acting?.byCharacter?.[c.id];
        const exampleBlock = Array.isArray(styleExamples) && styleExamples.length
          ? `Writing examples (match vibe; do NOT copy):\n${styleExamples.map((s) => `- "${s}"`).join('\n')}`
          : '';
        return [
          `[${c.displayName} / id:${c.id}]`,
          `Personality: ${c.aiProfile.personality}`,
          `Speech style: ${c.aiProfile.speechStyle}`,
          actingNote,
          `Knot: ${c.knot || 'none'}`,
          `Current conviction: ${conviction} (${stage})`,
          `Expressions: ${c.expressions.join(', ')}`,
          sampleBlock,
          exampleBlock
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');

    const craftBlock = Array.isArray(acting?.globalCraft) && acting.globalCraft.length
      ? ['', '## Dialogue craft (VN / novel feel)', ...acting.globalCraft.map((r, i) => `${i + 1}. ${r}`)].join('\n')
      : '';

    const beatSection = interactive
      ? [
          '',
          '## Current beat (must follow)',
          interactive.objective,
          `Player prompt: ${interactive.playerPrompt}`,
          `Director goal: ${interactive.aiGoal}`,
          `Free replies so far ${gameState.interactiveReplyCount || 0} / ${interactive.maxFreeReplies}`,
          isDecisive
            ? '[IMPORTANT] The player just made a clear decision (quick action). Respond to it, then set advanceMainline: true. Do not keep chatting.'
            : gameState.interactiveReplyCount >= interactive.maxFreeReplies - 1
              ? '[IMPORTANT] This reply or the next must set advanceMainline: true and push the main story.'
              : ''
        ].join('\n')
      : '';

    return [
      'You are the AI narrative director for this visual novel.',
      'CRITICAL LANGUAGE LOCK: Write every dialogue text in natural colloquial English only. Never use Chinese characters in the text field. Never answer in Chinese.',
      '',
      '## World',
      director.world,
      '',
      '## Tone',
      director.tone,
      '',
      '## Narrative layers',
      director.layers,
      '',
      '## Rules',
      ...director.rules.map((r, i) => `${i + 1}. ${r}`),
      craftBlock,
      '',
      '## Current game state',
      `Scene: ${scene?.id || 'unknown'} — ${scene?.speakerName || ''}`,
      `Background: ${background?.displayName || gameState.currentBackground} — ${background?.description || ''}`,
      `Day ${gameState.day}`,
      `Antibiotics: ${gameState.resources.antibiotics}, gasoline: ${gameState.resources.gasoline}`,
      `Unserious threshold: ${gameState.seriousnessThreshold}`,
      '',
      '## Character sheets',
      npcLines || '(character sheets pending)',
      beatSection,
      '',
      '## Output format',
      'Return one json object only. No markdown. No code fences.',
      'Fill real character dialogue. Do not copy schema field descriptions.',
      'Fields:',
      JSON.stringify(director.responseSchema, null, 2)
    ].join('\n');
  }

  function pickConvictionStage(stages, value) {
    if (!stages) return 'unknown';
    const thresholds = Object.keys(stages)
      .map(Number)
      .sort((a, b) => b - a);
    for (const t of thresholds) {
      if (value >= t) return stages[String(t)];
    }
    return stages['0'] || 'unknown';
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
        return { role: 'user', content: `Player said: ${entry.text}` };
      }
      const name = entry.text?.name || 'NPC';
      const text = entry.text?.text || '';
      return { role: 'assistant', content: `[${name}] ${text}` };
    });
  }

  function normalizeForCompare(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
  }

  function isPlaceholderText(text) {
    const normalized = normalizeForCompare(text);
    const banned = [
      'dialoguebodyinenglishonly',
      'writeanewincharacterenglishlineforthisplayerinput',
      'iheardyou',
      'okaywelldoitunyaurway',
      'iheardyouletmethink'
    ];
    return banned.includes(normalized);
  }

  function isEchoOfPlayer(npcText, playerText) {
    const a = normalizeForCompare(npcText);
    const b = normalizeForCompare(playerText);
    if (!a || !b) return false;
    return a === b;
  }

  function extractJsonObject(rawContent) {
    let source = String(rawContent || '').trim();
    const fence = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) source = fence[1].trim();

    try {
      return JSON.parse(source);
    } catch {
      /* continue */
    }

    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = source.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        try {
          return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1'));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  function extractDialogueText(parsed) {
    if (!parsed || typeof parsed !== 'object') return '';
    if (typeof parsed.text === 'string') return parsed.text.trim();
    if (parsed.text && typeof parsed.text.content === 'string') return parsed.text.content.trim();
    if (typeof parsed.dialogue === 'string') return parsed.dialogue.trim();
    if (typeof parsed.message === 'string') return parsed.message.trim();
    return '';
  }

  function buildContextualFallback(fallbackSpeaker, playerText, isDecisive) {
    const snippet = playerText.replace(/\s+/g, ' ').trim().slice(0, 42);
    const name = fallbackSpeaker.displayName || 'Ringo';
    const text = isDecisive
      ? `${name === 'Xian' ? '...' : 'Okay.'} I get what you mean. We'll do that.`
      : `${name === 'Xian' ? '...Yeah.' : "Yeah, I hear you."} About "${snippet}${playerText.length > 42 ? '…' : ''}" — I'm with you.`;
    return {
      speakerId: fallbackSpeaker.id,
      speakerName: fallbackSpeaker.displayName,
      expression: fallbackSpeaker.expressions?.[0] || 'neutral',
      text,
      convictionDelta: {},
      seriousnessDelta: 0,
      advanceMainline: Boolean(isDecisive)
    };
  }

  function parseResponse(rawContent, fallbackSpeaker, playerText, isDecisive = false) {
    const parsed = extractJsonObject(rawContent);
    const replyText = extractDialogueText(parsed);

    if (!replyText || isPlaceholderText(replyText)) {
      return null;
    }

    if (isEchoOfPlayer(replyText, playerText)) {
      console.warn('[AI] Blocked echo of player input');
      return null;
    }

    const delta = parsed.convictionDelta;
    const convictionDelta =
      delta && typeof delta === 'object' && !Array.isArray(delta) ? delta : {};

    return {
      speakerId: parsed.speakerId || fallbackSpeaker.id,
      speakerName: parsed.speakerName || fallbackSpeaker.displayName,
      expression: parsed.expression || 'neutral',
      text: replyText,
      convictionDelta,
      seriousnessDelta: Number(parsed.seriousnessDelta) || 0,
      advanceMainline: Boolean(parsed.advanceMainline)
    };
  }

  function buildPlayerTurnContent(playerText, isRetry = false) {
    const retryLine = isRetry
      ? 'Previous output was invalid. Return a real json object with a unique in-character text field.\n'
      : '';
    return [
      retryLine,
      'Return one json object for this visual novel turn.',
      'The player may have typos or broken grammar. Infer the intended meaning and reply in-character.',
      'Do not lecture about English. Do not copy the player. Do not use filler like "I heard you".',
      '',
      `Player says: """${playerText}"""`
    ].join('\n');
  }

  async function requestChat(messages) {
    const response = await VNAuth.apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `AI request failed (${response.status})`);
    }
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * @param {string} playerText
   * @param {object} context
   */
  async function sendPlayerMessage(playerText, context) {
    const director = await loadDirectorPrompt();
    const acting = await loadActingExamples();
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

    const systemContent = buildSystemPrompt({
      director,
      characters,
      gameState,
      scene,
      background,
      interactive,
      isDecisive,
      acting
    });

    const messages = [
      { role: 'system', content: systemContent },
      ...buildHistoryMessages(dialogueHistory, playerText),
      { role: 'user', content: buildPlayerTurnContent(playerText) }
    ];

    const rawContent = await requestChat(messages);
    let reply = parseResponse(rawContent, fallbackSpeaker, playerText, isDecisive);

    if (!reply) {
      const retryMessages = [
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content: buildPlayerTurnContent(playerText, true)
        }
      ];
      const retryRaw = await requestChat(retryMessages);
      reply = parseResponse(retryRaw, fallbackSpeaker, playerText, isDecisive);
    }

    return reply || buildContextualFallback(fallbackSpeaker, playerText, isDecisive);
  }

  return { getStatus, sendPlayerMessage };
})();
