/**
 * Visual Novel Engine — main.js
 * Core game state, DOM updates, and event handling.
 */

// ---------------------------------------------------------------------------
// Game state (runtime; initialized from data/gameState.json)
// ---------------------------------------------------------------------------

const gameState = {
  currentCharacter: 'xian',
  currentExpression: 'neutral',
  currentBackground: 'campsite_night',
  currentScene: 'prologue_campsite',
  dialogueHistory: [],
  isWaitingForAI: false,
  turn: 'npc',
  isTyping: false,
  typewriterTimer: null,
  day: 1,
  resources: { antibiotics: 3, gasoline: 5 },
  conviction: { xian: 0, ringo: 0, male_member: 0 },
  knotResolved: { xian: false, ringo: false, male_member: false },
  seriousnessThreshold: 0,
  flags: {
    reachedRadioTower: false,
    xianAlive: true,
    prologueComplete: false,
    chapter01Complete: false,
    xianInjured: false,
    xianImmobile: false,
    highwayArcStarted: false
  },
  currentChapter: 'prologue',
  storyMode: 'scripted',
  interactiveReplyCount: 0,
  currentInteractive: null
};

/** Scene ids queued after interactive beat ends */
let advanceSceneQueue = [];

/** Next player input is a decisive action (from chip or matching suggestion). */
let pendingInputIsDecisive = false;

/** Loaded content registries */
let backgroundsData = {};
let charactersData = {};
let storyScenes = [];
let storySceneIndex = 0;
let currentChapterMeta = null;
let storyProgressData = null;

const CHAPTER_FILES = {
  prologue: 'data/story/prologue.json',
  chapter01_highway: 'data/story/chapter01_highway.json'
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const characterSpriteEl = document.getElementById('character-sprite');
const characterSpriteLabelEl = document.getElementById('character-sprite-label');
const backgroundLayerEl = document.getElementById('background-layer');
const backgroundLabelEl = document.getElementById('background-label');
const gameContentEl = document.getElementById('game-content');
const characterNameEl = document.getElementById('character-name');
const dialogueTextEl = document.getElementById('dialogue-text');
const dialogueBoxEl = document.getElementById('dialogue-box');
const storyObjectiveEl = document.getElementById('story-objective');
const modeHintEl = document.getElementById('mode-hint');
const suggestionChipsEl = document.getElementById('suggestion-chips');
const advanceMainlineBtnEl = document.getElementById('advance-mainline-btn');
const playerInputEl = document.getElementById('player-input');
const playerInputAreaEl = document.getElementById('player-input-area');
const sendBtnEl = document.getElementById('send-btn');

/** Full text of the dialogue currently being typewritten (for click-to-skip). */
let currentTypewriterText = '';

/** NPC dialogue entry queued for history once typewriter finishes. */
let pendingDialogue = null;

/** Callback after typewriter finishes (used by scripted scenes). */
let onTypewriterComplete = null;

/** True when a scripted line has finished and waits for a click to continue. */
let awaitingSceneAdvance = false;

/** Milliseconds per character for the typewriter effect. */
const TYPEWRITER_MS_PER_CHAR = 55;

/** Minimum pause after a line finishes, before "click to continue" is accepted. */
const MIN_READ_MS = 600;

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/**
 * Fetches a JSON file from the data directory.
 * @param {string} path
 */
async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

/**
 * Loads backgrounds, characters, saved state, and opening story.
 */
async function loadGameData() {
  const [backgrounds, characters, savedState, prologue, progress] = await Promise.all([
    loadJson('data/backgrounds.json'),
    loadJson('data/characters.json'),
    loadJson('data/gameState.json'),
    loadJson('data/story/prologue.json'),
    loadJson('data/story/progress.json')
  ]);

  backgrounds.backgrounds.forEach((bg) => {
    backgroundsData[bg.id] = bg;
  });

  characters.characters.forEach((char) => {
    charactersData[char.id] = char;
  });

  storyProgressData = progress;
  Object.assign(gameState, savedState);

  const startChapter = savedState.currentChapter || 'prologue';
  await loadChapter(startChapter, { resetIndex: true });
}

/**
 * Loads a chapter JSON into the active scene list.
 * @param {string} chapterId
 * @param {{ resetIndex?: boolean }} [options]
 */
async function loadChapter(chapterId, options = {}) {
  const path = CHAPTER_FILES[chapterId];
  if (!path) throw new Error(`未知章节: ${chapterId}`);

  const chapter = await loadJson(path);
  currentChapterMeta = chapter;
  gameState.currentChapter = chapterId;
  storyScenes = chapter.scenes;
  if (options.resetIndex) storySceneIndex = 0;

  updateChapterProgressUI();
}

// ---------------------------------------------------------------------------
// Character & background updates
// ---------------------------------------------------------------------------

/**
 * Swaps the character sprite (image or text placeholder).
 * @param {string} characterId
 * @param {string} expression
 */
function updateCharacterSprite(characterId, expression) {
  gameState.currentCharacter = characterId;
  gameState.currentExpression = expression;

  const character = charactersData[characterId];
  if (!character) {
    console.warn(`[updateCharacterSprite] Unknown character: ${characterId}`);
    characterSpriteLabelEl.textContent = `【立绘占位】${characterId}`;
    characterSpriteEl.classList.remove('has-image');
    characterSpriteEl.style.backgroundImage = '';
    return;
  }

  const spritePath = character.spritePath
    ? character.spritePath.replace('{expression}', expression)
    : null;

  console.log(`[updateCharacterSprite] ${character.displayName}, ${expression}`);

  if (spritePath) {
    const img = new Image();
    img.onload = () => {
      characterSpriteEl.style.backgroundImage = `url('${spritePath}')`;
      characterSpriteEl.classList.add('has-image');
      characterSpriteLabelEl.textContent = '';
    };
    img.onerror = () => {
      characterSpriteEl.classList.remove('has-image');
      characterSpriteEl.style.backgroundImage = '';
      characterSpriteLabelEl.textContent =
        character.textPlaceholder || `【立绘占位】${character.displayName} · ${expression}`;
    };
    img.src = spritePath;
  } else {
    characterSpriteEl.classList.remove('has-image');
    characterSpriteEl.style.backgroundImage = '';
    characterSpriteLabelEl.textContent =
      character.textPlaceholder || `【立绘占位】${character.displayName} · ${expression}`;
  }
}

/**
 * Swaps the background (image or text placeholder).
 * @param {string} backgroundId
 */
function updateBackground(backgroundId) {
  gameState.currentBackground = backgroundId;

  const bg = backgroundsData[backgroundId];
  if (!bg) {
    console.warn(`[updateBackground] Unknown background: ${backgroundId}`);
    backgroundLayerEl.style.backgroundColor = 'var(--color-bg-layer)';
    backgroundLabelEl.textContent = `【背景占位】${backgroundId}`;
    backgroundLayerEl.classList.remove('has-image', 'is-bright');
    backgroundLayerEl.style.backgroundImage = '';
    return;
  }

  console.log(`[updateBackground] ${bg.displayName}`);

  backgroundLayerEl.style.backgroundColor = bg.color;
  backgroundLabelEl.textContent = bg.description;
  backgroundLayerEl.classList.toggle('is-bright', bg.color === '#e8e8e8');

  const bgPath = `backgrounds/${backgroundId}.png`;
  const img = new Image();
  img.onload = () => {
    backgroundLayerEl.style.backgroundImage = `url('${bgPath}')`;
    backgroundLayerEl.classList.add('has-image');
  };
  img.onerror = () => {
    backgroundLayerEl.classList.remove('has-image');
    backgroundLayerEl.style.backgroundImage = '';
  };
  img.src = bgPath;
}

function applySceneEnterEffects(scene) {
  if (scene.onEnterFlags) {
    Object.assign(gameState.flags, scene.onEnterFlags);
  }
  if (scene.onEnterResources) {
    Object.entries(scene.onEnterResources).forEach(([key, delta]) => {
      if (gameState.resources[key] !== undefined) {
        gameState.resources[key] = clamp(gameState.resources[key] + delta, 0, 99);
      }
    });
  }
}

function applyInteractiveCompleteEffects(interactive) {
  if (interactive?.onCompleteFlags) {
    Object.assign(gameState.flags, interactive.onCompleteFlags);
  }
}

function setStoryMode(mode) {
  gameState.storyMode = mode;
  dialogueBoxEl.classList.toggle('mode-scripted', mode === 'scripted');
  dialogueBoxEl.classList.toggle('mode-interactive', mode === 'interactive');
}

function getSceneById(id) {
  return storyScenes.find((s) => s.id === id);
}

function enterInteractiveMode(interactive) {
  gameState.currentInteractive = interactive;
  gameState.interactiveReplyCount = 0;
  setStoryMode('interactive');

  storyObjectiveEl.textContent = interactive.objective;
  storyObjectiveEl.hidden = false;
  modeHintEl.textContent =
    `${interactive.playerPrompt} · 点「快捷行动」= 决策后推进；自己打字 = 可多聊 ${interactive.maxFreeReplies} 轮`;
  modeHintEl.hidden = false;

  renderSuggestionChips(interactive.suggestions || []);
  advanceMainlineBtnEl.hidden = false;
  updateAdvanceButtonLabel();
}

function exitInteractiveMode() {
  gameState.currentInteractive = null;
  gameState.interactiveReplyCount = 0;
  setStoryMode('scripted');
  storyObjectiveEl.hidden = true;
  modeHintEl.hidden = true;
  suggestionChipsEl.hidden = true;
  suggestionChipsEl.innerHTML = '';
  advanceMainlineBtnEl.hidden = true;
}

function renderSuggestionChips(suggestions) {
  suggestionChipsEl.innerHTML = '';

  if (!suggestions.length) {
    suggestionChipsEl.hidden = true;
    return;
  }

  const label = document.createElement('div');
  label.className = 'suggestion-label';
  label.textContent = '▸ 快捷行动（角色回应后自动推进剧情）';
  suggestionChipsEl.appendChild(label);

  suggestions.forEach((text) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'suggestion-chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      if (gameState.turn !== 'player' || gameState.storyMode !== 'interactive') return;
      pendingInputIsDecisive = true;
      playerInputEl.value = text;
      handlePlayerInput();
    });
    suggestionChipsEl.appendChild(chip);
  });
  suggestionChipsEl.hidden = false;
}

/**
 * Returns true if typed input is essentially the same as a suggestion option.
 */
function isDecisiveInput(input, suggestions) {
  const normalized = input.trim().replace(/\s+/g, '');
  if (!normalized) return false;

  return suggestions.some((suggestion) => {
    const target = suggestion.trim().replace(/\s+/g, '');
    if (normalized === target) return true;
    if (normalized.length >= 6 && target.includes(normalized)) return true;
    if (target.length >= 6 && normalized.includes(target)) return true;
    return false;
  });
}

function updateAdvanceButtonLabel() {
  const max = gameState.currentInteractive?.maxFreeReplies ?? 2;
  const left = Math.max(0, max - gameState.interactiveReplyCount);
  advanceMainlineBtnEl.textContent =
    left > 0 ? `推进剧情 →（还可聊 ${left} 轮）` : '推进剧情 →';
}

/**
 * After interactive beat, play queued mainline scenes.
 */
function endInteractiveAndAdvanceMainline() {
  const interactive = gameState.currentInteractive;
  applyInteractiveCompleteEffects(interactive);

  if (!interactive?.advanceSceneIds?.length) {
    exitInteractiveMode();
    return;
  }

  advanceSceneQueue = [...interactive.advanceSceneIds];
  exitInteractiveMode();
  playNextQueuedScene();
}

function playNextQueuedScene() {
  if (advanceSceneQueue.length === 0) {
    if (storySceneIndex >= storyScenes.length - 1) {
      gameState.flags.prologueComplete = true;
    }
    return;
  }

  const sceneId = advanceSceneQueue.shift();
  const scene = getSceneById(sceneId);
  if (!scene) {
    playNextQueuedScene();
    return;
  }

  storySceneIndex = storyScenes.findIndex((s) => s.id === sceneId);
  playScene(scene, { fromQueue: true });
}

// ---------------------------------------------------------------------------
// Scripted scene playback
// ---------------------------------------------------------------------------

/**
 * Applies a single scene entry from story JSON.
 * @param {object} scene
 * @param {{ fromQueue?: boolean }} [options]
 */
function playScene(scene, options = {}) {
  gameState.currentScene = scene.id;
  applySceneEnterEffects(scene);
  updateBackground(scene.background);

  if (scene.character) {
    updateCharacterSprite(scene.character, scene.expression || 'neutral');
  }

  const speakerName = scene.speakerName || '[NAME]';

  if (scene.playerTurn) {
    onTypewriterComplete = null;
    awaitingSceneAdvance = false;

    if (scene.interactive) {
      onTypewriterCompleteAfterPlayerLine = () => enterInteractiveMode(scene.interactive);
    } else {
      onTypewriterCompleteAfterPlayerLine = null;
      setStoryMode('interactive');
    }

    displayDialogue(speakerName, scene.text);
    return;
  }

  setStoryMode('scripted');
  onTypewriterCompleteAfterPlayerLine = null;

  if (options.fromQueue) {
    onTypewriterComplete = () => {
      if (advanceSceneQueue.length > 0) {
        playNextQueuedScene();
        return;
      }
      if (scene.chapterEnd) {
        showChapterComplete();
        return;
      }
      if (scene.id === 'prologue_closing') {
        transitionToNextChapter();
        return;
      }
      // Queue drained — continue the main scene list (fixes stuck after ch1_shot etc.)
      if (storySceneIndex < storyScenes.length - 1) {
        storySceneIndex += 1;
        playScene(storyScenes[storySceneIndex]);
      }
    };
  } else {
    onTypewriterComplete = () => {
      if (storySceneIndex < storyScenes.length - 1) {
        storySceneIndex += 1;
        playScene(storyScenes[storySceneIndex]);
      }
    };
  }

  awaitingSceneAdvance = false;
  displayDialogue(speakerName, scene.text);
  updateChapterProgressUI();
}

/** Runs after a playerTurn intro line finishes typewriting */
let onTypewriterCompleteAfterPlayerLine = null;

/**
 * Auto-continue from prologue into chapter 01.
 */
async function transitionToNextChapter() {
  const nextId = currentChapterMeta?.nextChapter;
  if (!nextId || !CHAPTER_FILES[nextId]) return;

  gameState.flags.prologueComplete = true;
  await loadChapter(nextId, { resetIndex: true });

  storyObjectiveEl.hidden = false;
  storyObjectiveEl.textContent = `【${currentChapterMeta.title}】`;
  modeHintEl.hidden = false;
  modeHintEl.textContent = '章节衔接中…点击继续';

  onTypewriterComplete = null;
  playScene(storyScenes[0]);
}

/**
 * Shown when a chapter's last scene finishes.
 */
function showChapterComplete() {
  const chapterId = gameState.currentChapter;
  if (chapterId === 'chapter01_highway') {
    gameState.flags.chapter01Complete = true;
    gameState.flags.highwayArcStarted = true;
  }

  exitInteractiveMode();
  setStoryMode('scripted');
  lockInput();
  updateChapterProgressUI();

  const nextId = currentChapterMeta?.nextChapter;
  const nextChapterInfo = storyProgressData?.chapters?.find((c) => c.id === nextId);

  storyObjectiveEl.hidden = false;
  storyObjectiveEl.textContent = `【${currentChapterMeta?.title || '章节'} · 已完成】`;
  modeHintEl.hidden = false;

  if (nextChapterInfo?.status === 'implemented' && CHAPTER_FILES[nextId]) {
    modeHintEl.textContent = '下一章已就绪。刷新页面将从序章重玩；后续将支持存档续玩。';
  } else {
    modeHintEl.textContent = `下一章「${nextChapterInfo?.title || '未定'}」尚在制作中。可查看 PROGRESS 了解总进度。`;
  }

  advanceMainlineBtnEl.hidden = true;
}

/**
 * Updates the objective bar with current chapter / beat progress.
 */
function updateChapterProgressUI() {
  if (!storyProgressData || !currentChapterMeta) return;

  const chapterEntry = storyProgressData.chapters.find((c) => c.id === gameState.currentChapter);
  if (!chapterEntry) return;

  const total = chapterEntry.beats.length;
  const currentBeat = chapterEntry.beats.findIndex((b) => b.sceneId === gameState.currentScene);
  const step = currentBeat >= 0 ? currentBeat + 1 : '?';

  if (gameState.storyMode === 'interactive' && gameState.currentInteractive?.objective) {
    return;
  }

  if (!storyObjectiveEl.hidden && gameState.storyMode === 'interactive') return;

  if (gameState.storyMode === 'scripted' && !awaitingSceneAdvance) {
    storyObjectiveEl.hidden = false;
    storyObjectiveEl.textContent = `【${chapterEntry.title}】进度 ${step}/${total}`;
  }
}

// ---------------------------------------------------------------------------
// Input lock / unlock
// ---------------------------------------------------------------------------

function lockInput() {
  playerInputEl.disabled = true;
  sendBtnEl.disabled = true;
  playerInputEl.placeholder = '等待中…';
  playerInputAreaEl.classList.add('input-locked');
}

function unlockInput() {
  playerInputEl.disabled = false;
  sendBtnEl.disabled = false;
  playerInputEl.placeholder = '输入你的回应…';
  playerInputAreaEl.classList.remove('input-locked');
}

// ---------------------------------------------------------------------------
// Typewriter helpers
// ---------------------------------------------------------------------------

function clearTypewriter() {
  if (gameState.typewriterTimer !== null) {
    clearInterval(gameState.typewriterTimer);
    gameState.typewriterTimer = null;
  }
}

function setDialogueTypingCursor(isTyping) {
  dialogueTextEl.classList.toggle('is-typing', isTyping);
}

function setAwaitingAdvance(waiting) {
  awaitingSceneAdvance = waiting;
  dialogueTextEl.classList.toggle('awaiting-advance', waiting);
  if (waiting) {
    setDialogueTypingCursor(true);
  }
}

/**
 * After a scripted line finishes, player clicks to advance to the next scene.
 */
function advanceScriptedScene() {
  if (!awaitingSceneAdvance || gameState.isTyping) return;

  setAwaitingAdvance(false);
  setDialogueTypingCursor(false);
  modeHintEl.hidden = gameState.storyMode !== 'interactive';

  if (typeof onTypewriterComplete === 'function') {
    const callback = onTypewriterComplete;
    onTypewriterComplete = null;
    callback();
  }
}

let readDelayTimer = null;

function finishTypewriter() {
  clearTypewriter();
  gameState.isTyping = false;
  setDialogueTypingCursor(false);

  if (pendingDialogue) {
    addToHistory('npc', pendingDialogue);
    pendingDialogue = null;
  }

  if (gameState.isWaitingForAI) {
    gameState.turn = 'npc';
    return;
  }

  // Scripted scene: wait for click
  if (typeof onTypewriterComplete === 'function') {
    gameState.turn = 'npc';
    lockInput();
    if (readDelayTimer) clearTimeout(readDelayTimer);
    readDelayTimer = setTimeout(() => {
      readDelayTimer = null;
      setAwaitingAdvance(true);
      modeHintEl.textContent = '点击文字或按空格继续';
      modeHintEl.hidden = false;
    }, MIN_READ_MS);
    return;
  }

  // Player turn intro line finished → open interactive input
  if (typeof onTypewriterCompleteAfterPlayerLine === 'function') {
    const callback = onTypewriterCompleteAfterPlayerLine;
    onTypewriterCompleteAfterPlayerLine = null;
    callback();
    gameState.turn = 'player';
    unlockInput();
    modeHintEl.textContent = gameState.currentInteractive?.playerPrompt || '输入你的回应…';
    playerInputEl.focus();
    return;
  }

  gameState.turn = 'player';
  unlockInput();
  playerInputEl.focus();
}

function skipTypewriter() {
  if (!gameState.isTyping) return;
  dialogueTextEl.textContent = currentTypewriterText;
  finishTypewriter();
}

// ---------------------------------------------------------------------------
// Dialogue display
// ---------------------------------------------------------------------------

function displayDialogue(characterName, text, skipHistory = false) {
  clearTypewriter();
  if (readDelayTimer) {
    clearTimeout(readDelayTimer);
    readDelayTimer = null;
  }
  setAwaitingAdvance(false);
  if (gameState.storyMode !== 'interactive') {
    modeHintEl.hidden = true;
  }

  characterNameEl.textContent = characterName;
  dialogueTextEl.textContent = '';
  currentTypewriterText = text;
  pendingDialogue = skipHistory ? null : { name: characterName, text };

  gameState.isTyping = true;
  gameState.turn = 'npc';
  setDialogueTypingCursor(true);
  lockInput();

  let index = 0;
  gameState.typewriterTimer = setInterval(() => {
    index += 1;
    dialogueTextEl.textContent = text.slice(0, index);

    if (index >= text.length) {
      finishTypewriter();
    }
  }, TYPEWRITER_MS_PER_CHAR);
}

function addToHistory(role, text) {
  gameState.dialogueHistory.push({ role, text, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Player input handling
// ---------------------------------------------------------------------------

function handlePlayerInput() {
  if (gameState.turn !== 'player') return;

  const inputText = playerInputEl.value.trim();
  if (!inputText) return;

  const suggestions = gameState.currentInteractive?.suggestions || [];
  const isDecisive = pendingInputIsDecisive || isDecisiveInput(inputText, suggestions);
  pendingInputIsDecisive = false;

  addToHistory('player', inputText);
  playerInputEl.value = '';
  lockInput();
  gameState.turn = 'npc';
  processPlayerInput(inputText, { isDecisive });
}

function processPlayerInput(text, options = {}) {
  if (gameState.storyMode !== 'interactive') return;

  const { isDecisive = false } = options;

  gameState.isWaitingForAI = true;
  gameState.interactiveReplyCount += 1;
  updateAdvanceButtonLabel();
  displayDialogue('…', '…', true);

  AI.sendPlayerMessage(text, {
    gameState,
    charactersData,
    backgroundsData,
    storyScenes,
    storySceneIndex,
    dialogueHistory: gameState.dialogueHistory,
    isDecisive
  })
    .then((reply) => {
      gameState.isWaitingForAI = false;
      applyAIStateChanges(reply);

      const character = charactersData[reply.speakerId];
      const expression = character?.expressions?.includes(reply.expression)
        ? reply.expression
        : character?.expressions?.[0] || 'neutral';

      if (character && reply.speakerId !== 'narrator') {
        updateCharacterSprite(reply.speakerId, expression);
      }

      const maxReplies = gameState.currentInteractive?.maxFreeReplies ?? 2;
      const shouldAdvance =
        isDecisive ||
        reply.advanceMainline ||
        gameState.interactiveReplyCount >= maxReplies;

      if (shouldAdvance) {
        onTypewriterCompleteAfterPlayerLine = null;
        onTypewriterComplete = () => endInteractiveAndAdvanceMainline();
      } else {
        onTypewriterComplete = null;
      }

      displayDialogue(reply.speakerName, reply.text);
    })
    .catch((error) => {
      console.error('[AI]', error);
      gameState.isWaitingForAI = false;
      gameState.interactiveReplyCount = Math.max(0, gameState.interactiveReplyCount - 1);
      updateAdvanceButtonLabel();

      const scene = storyScenes[storySceneIndex];
      const fallbackId = scene?.character || 'ringo';
      updateCharacterSprite(fallbackId, 'neutral');

      displayDialogue('系统', formatAIError(error));
    });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Applies conviction / seriousness changes from AI JSON response.
 * @param {object} reply
 */
function applyAIStateChanges(reply) {
  if (reply.convictionDelta) {
    Object.entries(reply.convictionDelta).forEach(([id, delta]) => {
      if (gameState.conviction[id] !== undefined && typeof delta === 'number') {
        gameState.conviction[id] = clamp(gameState.conviction[id] + delta, 0, 100);
      }
    });
  }

  if (typeof reply.seriousnessDelta === 'number') {
    gameState.seriousnessThreshold = clamp(
      gameState.seriousnessThreshold + reply.seriousnessDelta,
      0,
      100
    );
  }
}

function formatAIError(error) {
  const msg = error?.message || String(error);
  if (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('Load failed')) {
    return [
      '浏览器无法连接本地服务器（Failed to fetch）。',
      '',
      '请确认：',
      '1) 终端已运行 npm start（不是 npx serve）',
      '2) 地址栏是 http://localhost:8765（不要双击 index.html）',
      '3) 若用 Cursor 内置浏览器失败，请改用 Chrome/Edge 打开上述地址',
      '4) 修改 .env 后需重启 npm start'
    ].join('\n');
  }
  return `AI 暂时无法回复：${msg}`;
}

async function verifyGameServer() {
  if (window.location.protocol === 'file:') {
    return { ok: false, reason: 'file-protocol' };
  }
  try {
    const response = await fetch('/api/ai/status');
    if (!response.ok) return { ok: false, reason: 'status-fail' };
    const data = await response.json();
    return { ok: true, data };
  } catch {
    return { ok: false, reason: 'fetch-fail' };
  }
}

// ---------------------------------------------------------------------------
// LOG panel
// ---------------------------------------------------------------------------

const logPanelEl = document.createElement('div');
logPanelEl.id = 'log-panel';
logPanelEl.hidden = true;

const logPanelCloseBtn = document.createElement('button');
logPanelCloseBtn.id = 'log-panel-close';
logPanelCloseBtn.type = 'button';
logPanelCloseBtn.textContent = '[X]';
logPanelCloseBtn.setAttribute('aria-label', 'Close log');

const logPanelContentEl = document.createElement('div');
logPanelContentEl.id = 'log-panel-content';

logPanelEl.appendChild(logPanelCloseBtn);
logPanelEl.appendChild(logPanelContentEl);
gameContentEl.appendChild(logPanelEl);

function renderLogPanel() {
  logPanelContentEl.innerHTML = '';

  gameState.dialogueHistory.forEach((entry) => {
    const entryEl = document.createElement('div');

    if (entry.role === 'npc') {
      entryEl.className = 'log-entry-npc';
      const nameEl = document.createElement('span');
      nameEl.className = 'log-entry-name';
      nameEl.textContent = entry.text.name;
      const textEl = document.createElement('span');
      textEl.className = 'log-entry-text';
      textEl.textContent = entry.text.text;
      entryEl.appendChild(nameEl);
      entryEl.appendChild(textEl);
    } else {
      entryEl.className = 'log-entry-player';
      entryEl.textContent = '> ' + entry.text;
    }

    logPanelContentEl.appendChild(entryEl);
  });
}

function toggleLogPanel() {
  if (logPanelEl.hidden) {
    renderLogPanel();
    logPanelEl.hidden = false;
    progressPanelEl.hidden = true;
  } else {
    logPanelEl.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// PROGRESS panel (story progress table)
// ---------------------------------------------------------------------------

const progressPanelEl = document.createElement('div');
progressPanelEl.id = 'progress-panel';
progressPanelEl.hidden = true;

const progressPanelCloseBtn = document.createElement('button');
progressPanelCloseBtn.id = 'progress-panel-close';
progressPanelCloseBtn.type = 'button';
progressPanelCloseBtn.textContent = '[X]';
progressPanelCloseBtn.setAttribute('aria-label', 'Close progress');

const progressPanelContentEl = document.createElement('div');
progressPanelContentEl.id = 'progress-panel-content';

progressPanelEl.appendChild(progressPanelCloseBtn);
progressPanelEl.appendChild(progressPanelContentEl);
gameContentEl.appendChild(progressPanelEl);

function renderProgressPanel() {
  if (!storyProgressData) return;

  const chapter = storyProgressData.chapters.find((c) => c.id === gameState.currentChapter);
  const beatIndex = chapter?.beats.findIndex((b) => b.sceneId === gameState.currentScene) ?? -1;

  let html = `<h2 class="progress-title">${storyProgressData.title}</h2>`;
  html += `<p class="progress-current">当前：${chapter?.title || '—'} · 第 ${beatIndex >= 0 ? beatIndex + 1 : '?'} / ${chapter?.beats.length || '?'} 节拍</p>`;

  storyProgressData.chapters.forEach((ch) => {
    const statusLabel =
      ch.status === 'implemented' ? '可玩' : ch.status === 'planned' ? '待写' : '大纲';
    const isCurrent = ch.id === gameState.currentChapter;
    html += `<section class="progress-chapter${isCurrent ? ' is-current' : ''}">`;
    html += `<h3>${ch.title} <span class="progress-status">[${statusLabel}]</span></h3>`;
    if (ch.summary) html += `<p class="progress-summary">${ch.summary}</p>`;
    html += '<ul class="progress-beats">';
    ch.beats.forEach((beat, i) => {
      let mark = '○';
      if (ch.id === gameState.currentChapter && beat.sceneId === gameState.currentScene) mark = '▶';
      else if (ch.id === gameState.currentChapter && i < beatIndex) mark = '✓';
      else if (ch.status === 'implemented' && ch.id !== gameState.currentChapter) {
        const chOrder = storyProgressData.chapters.findIndex((c) => c.id === ch.id);
        const curOrder = storyProgressData.chapters.findIndex((c) => c.id === gameState.currentChapter);
        if (chOrder < curOrder) mark = '✓';
      }
      html += `<li><span class="progress-mark">${mark}</span> ${beat.title}</li>`;
    });
    html += '</ul></section>';
  });

  progressPanelContentEl.innerHTML = html;
}

function toggleProgressPanel() {
  if (progressPanelEl.hidden) {
    renderProgressPanel();
    progressPanelEl.hidden = false;
    logPanelEl.hidden = true;
    settingsPanelEl.hidden = true;
  } else {
    progressPanelEl.hidden = true;
  }
}

progressPanelCloseBtn.addEventListener('click', () => {
  progressPanelEl.hidden = true;
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

sendBtnEl.addEventListener('click', handlePlayerInput);

playerInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    handlePlayerInput();
  }
});

dialogueTextEl.addEventListener('click', () => {
  if (gameState.isTyping) {
    skipTypewriter();
  } else if (awaitingSceneAdvance) {
    advanceScriptedScene();
  }
});

// Keyboard: Space / Enter advances scripted lines (when not typing in input)
document.addEventListener('keydown', (event) => {
  if (event.target === playerInputEl) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (gameState.isTyping) {
    event.preventDefault();
    skipTypewriter();
  } else if (awaitingSceneAdvance) {
    event.preventDefault();
    advanceScriptedScene();
  }
});

logPanelCloseBtn.addEventListener('click', () => {
  logPanelEl.hidden = true;
});

document.querySelectorAll('.toolbar-btn').forEach((btn) => {
  if (btn.textContent === 'LOG') {
    btn.addEventListener('click', toggleLogPanel);
  }
  if (btn.textContent === 'PROGRESS') {
    btn.addEventListener('click', toggleProgressPanel);
  }
  if (btn.textContent === 'SETTINGS') {
    btn.addEventListener('click', toggleSettingsPanel);
  }
});

// ---------------------------------------------------------------------------
// Settings panel (AI status)
// ---------------------------------------------------------------------------

const settingsPanelEl = document.createElement('div');
settingsPanelEl.id = 'settings-panel';
settingsPanelEl.hidden = true;
settingsPanelEl.innerHTML = `
  <button type="button" id="settings-panel-close">[X]</button>
  <h2 id="settings-title">设置 · AI 配置</h2>
  <div id="settings-content">
    <p id="ai-status-line">AI 状态：检测中…</p>
    <p id="ai-model-line"></p>

    <h3 class="settings-subtitle">你需要什么 API？</h3>
    <p class="settings-hint">
      <strong>Cursor 会员不能用于游戏。</strong>Cursor Pro 是编辑器里的 AI，不能接到你这个项目里。<br>
      需要单独去一个大模型平台注册，拿到 <code>API Key</code>（按量计费，通常很便宜）。
    </p>

    <table class="settings-table">
      <thead><tr><th>平台</th><th>适合</th><th>获取地址</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>智谱 AI</strong></td>
          <td>glm-4-flash 免费</td>
          <td>open.bigmodel.cn</td>
        </tr>
        <tr>
          <td><strong>DeepSeek</strong></td>
          <td>推荐试玩，便宜</td>
          <td>platform.deepseek.com</td>
        </tr>
        <tr>
          <td>OpenAI</td>
          <td>质量稳定，需外币支付</td>
          <td>platform.openai.com</td>
        </tr>
        <tr>
          <td>Moonshot</td>
          <td>国内可用</td>
          <td>platform.moonshot.cn</td>
        </tr>
        <tr>
          <td>通义千问</td>
          <td>国内可用</td>
          <td>dashscope.aliyuncs.com</td>
        </tr>
      </tbody>
    </table>

    <h3 class="settings-subtitle">配置步骤（只需一次）</h3>
    <ol class="settings-steps">
      <li>打开项目根目录的 <code>.env</code> 文件</li>
      <li>把 <code>AI_API_KEY=</code> 后面贴上你的密钥</li>
      <li>如用 DeepSeek，注释掉 OpenAI 两行，取消 DeepSeek 两行注释</li>
      <li>终端运行 <code>npm start</code> 重启服务器</li>
      <li>点下方「重新检测」确认已连接</li>
    </ol>

    <p class="settings-hint">不要把 .env 发给任何人，也不要提交到 git。</p>
    <button type="button" id="ai-recheck-btn" class="settings-action-btn">重新检测</button>
  </div>
`;
gameContentEl.appendChild(settingsPanelEl);

const aiStatusLineEl = document.getElementById('ai-status-line');
const aiModelLineEl = document.getElementById('ai-model-line');

async function refreshAIStatus() {
  aiStatusLineEl.textContent = 'AI 状态：检测中…';
  aiModelLineEl.textContent = '';

  if (window.location.protocol === 'file:') {
    aiStatusLineEl.textContent = 'AI 状态：无法使用（请用 npm start 打开）';
    aiModelLineEl.textContent = '不要直接打开 index.html 文件';
    return;
  }

  try {
    const status = await AI.getStatus();
    if (status.configured) {
      aiStatusLineEl.textContent = 'AI 状态：已连接 ✓';
      aiModelLineEl.textContent = `模型：${status.model} · ${window.location.origin}`;
    } else {
      aiStatusLineEl.textContent = 'AI 状态：未配置（缺少 AI_API_KEY）';
      aiModelLineEl.textContent = '请复制 .env.example → .env 并填入密钥';
    }
  } catch {
    aiStatusLineEl.textContent = 'AI 状态：无法连接服务器';
    aiModelLineEl.textContent = `请确认 npm start 已运行，并用 ${window.location.protocol}//${window.location.hostname}:8765 打开`;
  }
}

function toggleSettingsPanel() {
  if (settingsPanelEl.hidden) {
    settingsPanelEl.hidden = false;
    refreshAIStatus();
  } else {
    settingsPanelEl.hidden = true;
  }
}

document.getElementById('settings-panel-close').addEventListener('click', () => {
  settingsPanelEl.hidden = true;
});

document.getElementById('ai-recheck-btn').addEventListener('click', refreshAIStatus);

// ---------------------------------------------------------------------------
// Page load — load data and start prologue
// ---------------------------------------------------------------------------

advanceMainlineBtnEl.addEventListener('click', () => {
  if (gameState.storyMode !== 'interactive' || gameState.isTyping || gameState.isWaitingForAI) return;
  endInteractiveAndAdvanceMainline();
});

loadGameData()
  .then(async () => {
    setStoryMode('scripted');
    updateBackground(gameState.currentBackground);

    const serverCheck = await verifyGameServer();
    if (!serverCheck.ok) {
      displayDialogue(
        '系统',
        serverCheck.reason === 'file-protocol'
          ? '请用 npm start 启动后，在浏览器打开 http://localhost:8765 。直接打开 index.html 无法使用 AI。'
          : formatAIError(new Error('Failed to fetch'))
      );
      return;
    }

    playScene(storyScenes[0]);
  })
  .catch((error) => {
    console.error(error);
    displayDialogue(
      '系统',
      '无法加载剧情数据（需要本地服务器打开，不能直接 file://）。请用 npx serve 运行后刷新。'
    );
  });
