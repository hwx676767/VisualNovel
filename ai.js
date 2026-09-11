/**
 * AI dialogue module — builds prompts and calls /api/chat proxy.
 * Prompt pack: slim (cost). Full backup: backups/ai-prompt-full/ (see RESTORE.md).
 */
const AI = (() => {
  const PROMPT_CACHE = 'slim1';
  const HISTORY_LIMIT = 6;
  const SPEECH_SAMPLE_LIMIT = 3;
  const STYLE_EXAMPLE_LIMIT = 2;

  let directorPrompt = null;
  let actingExamples = null;

  async function loadDirectorPrompt() {
    if (directorPrompt) return directorPrompt;
    const response = await fetch(`data/prompts/director.json?v=${PROMPT_CACHE}`);
    if (!response.ok) throw new Error('Failed to load director.json');
    directorPrompt = await response.json();
    return directorPrompt;
  }

  async function loadActingExamples() {
    if (actingExamples) return actingExamples;
    try {
      const response = await fetch(`data/prompts/acting_examples.json?v=${PROMPT_CACHE}`);
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
   * Resolves who is physically present for this beat.
   * Prefer scene.present; otherwise infer from party + scene + history.
   * @returns {{ id: string, state: string }[]}
   */
  function resolvePresent(scene, interactive, charactersData, gameState, dialogueHistory) {
    if (Array.isArray(scene?.present) && scene.present.length) {
      return scene.present
        .map((entry) => {
          if (typeof entry === 'string') return { id: entry, state: '' };
          if (entry && entry.id) return { id: entry.id, state: entry.state || '' };
          return null;
        })
        .filter(Boolean);
    }

    const ids = new Set();
    for (const id of ['xian', 'ringo', 'miles']) {
      if (charactersData[id]) ids.add(id);
    }
    if (scene?.character && charactersData[scene.character]) ids.add(scene.character);
    if (scene?.speaker && charactersData[scene.speaker]) ids.add(scene.speaker);

    const hay = [
      interactive?.aiGoal || '',
      interactive?.objective || '',
      scene?.text || '',
      ...(dialogueHistory || []).slice(-8).map((h) => {
        if (h.role === 'player') return h.text || '';
        return `${h.text?.name || ''} ${h.text?.text || ''}`;
      })
    ]
      .join('\n')
      .toLowerCase();

    for (const [id, c] of Object.entries(charactersData || {})) {
      if (c.role !== 'npc' || !c.aiProfile) continue;
      const name = (c.displayName || '').toLowerCase();
      if (name && hay.includes(name.toLowerCase())) ids.add(id);
      if (hay.includes(id.toLowerCase())) ids.add(id);
    }

    return [...ids].map((id) => ({ id, state: '' }));
  }

  function uniqueStrings(list, limit) {
    const out = [];
    const seen = new Set();
    for (const item of list || []) {
      const key = String(item || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (limit && out.length >= limit) break;
    }
    return out;
  }

  /**
   * Builds the system prompt from director rules + character profiles + game state.
   */
  function buildSystemPrompt(context) {
    const {
      director,
      charactersData,
      gameState,
      scene,
      background,
      interactive,
      isDecisive = false,
      acting,
      dialogueHistory = []
    } = context;

    const present = resolvePresent(scene, interactive, charactersData, gameState, dialogueHistory);
    const allowedMap = interactive?.allowedExpressions || {};

    const npcLines = present
      .map((p) => charactersData[p.id])
      .filter((c) => c && c.role === 'npc' && c.aiProfile)
      .map((c) => {
        const conviction = gameState.conviction[c.id] ?? 0;
        const stage = pickConvictionStage(c.convictionStages, conviction);
        const samples = uniqueStrings(
          pickSpeechSamples(c.speechCorpus, conviction),
          SPEECH_SAMPLE_LIMIT
        );
        const styleExamples = uniqueStrings(acting?.byCharacter?.[c.id], STYLE_EXAMPLE_LIMIT).filter(
          (ex) => !samples.some((s) => normalizeForCompare(s) === normalizeForCompare(ex))
        );

        const allowed =
          Array.isArray(allowedMap[c.id]) && allowedMap[c.id].length
            ? allowedMap[c.id]
            : c.expressions || [];

        const sampleBlock = samples.length
          ? `Voice (match rhythm; do NOT copy):\n${samples.map((s) => `- "${s}"`).join('\n')}`
          : '';
        const actingNote = c.aiProfile.actingNotes
          ? `Acting: ${c.aiProfile.actingNotes}`
          : '';
        const exampleBlock = styleExamples.length
          ? `Style:\n${styleExamples.map((s) => `- "${s}"`).join('\n')}`
          : '';
        const knot = c.knot ? `Knot: ${c.knot}` : '';
        const personality = String(c.aiProfile.personality || '');
        const personalityShort =
          personality.length > 280 ? `${personality.slice(0, 277)}…` : personality;

        return [
          `[${c.displayName} / id:${c.id}]`,
          `Tendency: ${personalityShort}`,
          `Speech: ${c.aiProfile.speechStyle}`,
          actingNote,
          knot,
          `Conviction: ${conviction} (${stage})`,
          `Expressions: ${allowed.join(', ')}`,
          sampleBlock,
          exampleBlock
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');

    const whoHere = present.length
      ? [
          '',
          '## Who is here right now',
          ...present.map((p) => {
            const name = charactersData[p.id]?.displayName || p.id;
            return p.state
              ? `- ${name} (id:${p.id}): ${p.state}`
              : `- ${name} (id:${p.id})`;
          })
        ].join('\n')
      : '';

    const craftBlock = Array.isArray(acting?.globalCraft) && acting.globalCraft.length
      ? ['', '## Craft', ...acting.globalCraft.map((r, i) => `${i + 1}. ${r}`)].join('\n')
      : '';

    const contrast = acting?.contrastPairs?.pairs;
    const contrastBlock = Array.isArray(contrast) && contrast.length
      ? [
          '',
          '## Bad → good',
          ...contrast.map((pair, i) => `${i + 1}. ✗ ${pair.bad}\n   ✓ ${pair.good}`)
        ].join('\n')
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
      contrastBlock,
      '',
      '## State',
      `Scene: ${scene?.id || 'unknown'} — ${scene?.speakerName || ''}`,
      `BG: ${background?.displayName || gameState.currentBackground}`,
      `Day ${gameState.day} | Abx ${gameState.resources.antibiotics} | Gas ${gameState.resources.gasoline} | Unserious ${gameState.seriousnessThreshold}`,
      whoHere,
      '',
      '## Present sheets',
      npcLines || '(none)',
      beatSection,
      '',
      '## Output',
      'One json object only. No markdown/fences. Real dialogue—do not copy schema text.',
      'speakerId from Who is here (or narrator). expression from that character Expressions list.',
      JSON.stringify(director.responseSchema)
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
    return [...stageSamples, ...general].filter(Boolean).slice(0, SPEECH_SAMPLE_LIMIT);
  }

  /**
   * Builds API history, avoiding duplicate trailing player message.
   */
  function buildHistoryMessages(history, currentPlayerText, limit = HISTORY_LIMIT) {
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
    const id = fallbackSpeaker.id;
    const byId = {
      xian: isDecisive ? "...Okay. We'll do that." : "...Yeah. Don't look at me like that.",
      ringo: isDecisive
        ? "Fine. We do your call—then the next thing."
        : "Don't spiral. Say it again, shorter.",
      miles: isDecisive
        ? "Got it. I'll grab what we need."
        : "Okay. I'm listening—just… give me a second.",
      rhine: "...Don't.",
      shooter: "...Don't."
    };
    const text =
      byId[id] ||
      (isDecisive ? "Okay. We go with that." : "…Say that again. Slower.");
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
      charactersData,
      gameState,
      scene,
      background,
      interactive,
      isDecisive,
      acting,
      dialogueHistory
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
