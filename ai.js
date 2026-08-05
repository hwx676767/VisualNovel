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
      'Output only one JSON object. No markdown. No code fences. Fields:',
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
      `...I heard you.${isDecisive ? " Okay. We'll do it your way." : ' Let me think.'}`,
      "Ringo looks at you and doesn't answer right away.",
      "Xian doesn't say anything. She just grips her camera a little tighter."
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

    const messages = [
      {
        role: 'system',
        content: buildSystemPrompt({
          director,
          characters,
          gameState,
          scene,
          background,
          interactive,
          isDecisive,
          acting
        })
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
      throw new Error(data.error || `AI request failed (${response.status})`);
    }

    const rawContent = data.choices?.[0]?.message?.content || '';
    return parseResponse(rawContent, fallbackSpeaker, playerText, isDecisive);
  }

  return { getStatus, sendPlayerMessage };
})();
