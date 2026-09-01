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
  conviction: { xian: 0, ringo: 0, miles: 0 },
  knotResolved: { xian: false, ringo: false, miles: false },
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
  currentInteractive: null,
  /** Limited freedom: interrupting scripted lines costs these. System-granted interactive beats are free. */
  chapterSegment: 'A',
  interruptsLeft: 5,
  interruptsMaxA: 5,
  interruptsMaxB: 2,
  interruptMode: false,
  currentPose: null,
  currentModifiers: {}
};

/** Scene ids queued after interactive beat ends */
let advanceSceneQueue = [];

/** Next player input is a decisive action (from chip or matching suggestion). */
let pendingInputIsDecisive = false;

/** Loaded content registries */
let backgroundsData = {};
let charactersData = {};
let spritesData = { characters: {} };
let storyScenes = [];
let storySceneIndex = 0;
let currentChapterMeta = null;
let storyProgressData = null;

const CHAPTER_FILES = {
  prologue: 'data/story/prologue.json',
  chapter01_highway: 'data/story/chapter01_highway.json',
  chapter02_towns: 'data/story/chapter02_towns.json',
  chapter03_tower: 'data/story/chapter03_tower.json',
  endings: 'data/story/endings.json'
};

/** Ending route thresholds (see data/story/endings.json) */
const ENDING_CONFIG = {
  hiddenSeriousness: 75,
  goodConviction: 70,
  trueConviction: 90,
  trueSeriousnessMax: 45
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const characterSpriteEl = document.getElementById('character-sprite');
const characterSpriteLabelEl = document.getElementById('character-sprite-label');
const characterSpriteImgEl = document.getElementById('character-sprite-img');
const backgroundLayerEl = document.getElementById('background-layer');
const backgroundLabelEl = document.getElementById('background-label');
const gameContentEl = document.getElementById('game-content');
const characterNameEl = document.getElementById('character-name');
const dialogueTextEl = document.getElementById('dialogue-text');
const dialogueBoxEl = document.getElementById('dialogue-box');
const storyObjectiveEl = document.getElementById('story-objective');
const modeHintEl = document.getElementById('mode-hint');
const suggestionChipsEl = document.getElementById('suggestion-chips');
const toggleSuggestionsBtnEl = document.getElementById('toggle-suggestions-btn');
const advanceMainlineBtnEl = document.getElementById('advance-mainline-btn');
const playerInputEl = document.getElementById('player-input');
const playerInputAreaEl = document.getElementById('player-input-area');
const sendBtnEl = document.getElementById('send-btn');
const interruptBarEl = document.getElementById('interrupt-bar');
const interruptCountEl = document.getElementById('interrupt-count');
const interruptBtnEl = document.getElementById('interrupt-btn');

const interruptHudEl = document.createElement('div');
interruptHudEl.id = 'interrupt-hud';
interruptHudEl.hidden = true;
if (gameContentEl) gameContentEl.appendChild(interruptHudEl);

let soundCueTimer = null;
function showSoundCue(cue) {
  if (window.VNAudio) {
    if (typeof cue === 'string') window.VNAudio.showCue(cue);
    else if (cue?.label) window.VNAudio.showCue(cue.label);
    return;
  }
  if (!cue) return;
  const existing = document.getElementById('sound-cue');
  const cueEl = existing || document.createElement('div');
  cueEl.id = 'sound-cue';
  cueEl.textContent = `♪ ${cue.label || cue}`;
  if (!existing) gameContentEl.appendChild(cueEl);
  cueEl.hidden = false;
  clearTimeout(soundCueTimer);
  soundCueTimer = setTimeout(() => { cueEl.hidden = true; }, 2600);
}

/**
 * Narration lines show a blank nameplate (no「旁白」label).
 */
function resolveSpeakerDisplayName(scene) {
  if (!scene) return '';
  if (scene.speaker === 'narrator') return '';
  const name = scene.speakerName;
  if (name === '旁白' || name === 'Narrator') return '';
  if (name) return name;
  return charactersData[scene.speaker]?.displayName || scene.speaker || '';
}

/** Full text of the dialogue currently being typewritten (for click-to-skip). */
let currentTypewriterText = '';

/** NPC dialogue entry queued for history once typewriter finishes. */
let pendingDialogue = null;

/** Callback after typewriter finishes (used by scripted scenes). */
let onTypewriterComplete = null;

/** True when a scripted line has finished and waits for a click to continue. */
let awaitingSceneAdvance = false;

/** Milliseconds per character for the typewriter effect (faster for English). */
const TYPEWRITER_MS_PER_CHAR = 22;

/** Minimum pause after a line finishes, before "click to continue" is accepted. */
const MIN_READ_MS = 350;

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
  const [backgrounds, characters, sprites, savedState, prologue, progress] = await Promise.all([
    loadJson('data/backgrounds.json'),
    loadJson('data/characters.json'),
    loadJson('data/sprites.json'),
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

  spritesData = sprites || { characters: {} };

  storyProgressData = progress;
  Object.assign(gameState, savedState);
  // Interrupt counters are runtime — always reset for a fresh session segment
  if (typeof gameState.interruptsLeft !== 'number') gameState.interruptsLeft = 5;
  if (!gameState.chapterSegment) gameState.chapterSegment = 'A';

  const startChapter = savedState.currentChapter || 'prologue';
  await loadChapter(startChapter, { resetIndex: true });
  resetInterruptsForChapter();
  updateInterruptUI();
}

/**
 * Picks ending route from accumulated game state.
 * @returns {'hidden'|'bad'|'true'|'good'|'normal'}
 */
function resolveEndingRoute(state = gameState) {
  const { flags, resources, conviction, seriousnessThreshold } = state;

  if (seriousnessThreshold >= ENDING_CONFIG.hiddenSeriousness) {
    return 'hidden';
  }

  if (!flags.xianAlive || (resources.antibiotics <= 0 && flags.xianImmobile)) {
    return 'bad';
  }

  const xianC = conviction.xian ?? 0;
  const ringoC = conviction.ringo ?? 0;
  const milesC = conviction.miles ?? 0;

  if (
    xianC >= ENDING_CONFIG.trueConviction &&
    ringoC >= ENDING_CONFIG.trueConviction &&
    milesC >= ENDING_CONFIG.trueConviction &&
    seriousnessThreshold <= ENDING_CONFIG.trueSeriousnessMax &&
    flags.campfireTalkComplete &&
    flags.reachedRadioTower
  ) {
    return 'true';
  }

  if (
    xianC >= ENDING_CONFIG.goodConviction &&
    ringoC >= ENDING_CONFIG.goodConviction &&
    milesC >= ENDING_CONFIG.goodConviction &&
    flags.reachedRadioTower
  ) {
    return 'good';
  }

  return 'normal';
}

/**
 * Loads a chapter JSON into the active scene list.
 * @param {string} chapterId
 * @param {{ resetIndex?: boolean, routeId?: string }} [options]
 */
async function loadChapter(chapterId, options = {}) {
  const path = CHAPTER_FILES[chapterId];
  if (!path) throw new Error(`Unknown chapter: ${chapterId}`);

  const chapter = await loadJson(path);
  currentChapterMeta = chapter;
  gameState.currentChapter = chapterId;

  if (chapter.routes) {
    const routeId = options.routeId || resolveEndingRoute(gameState);
    gameState.endingRoute = routeId;
    currentChapterMeta.activeRoute = routeId;
    const intro = chapter.sharedIntro || [];
    const routeScenes = chapter.routes[routeId] || chapter.routes.normal || [];
    storyScenes = [...intro, ...routeScenes];
  } else {
    gameState.endingRoute = null;
    storyScenes = chapter.scenes;
  }

  if (options.resetIndex) storySceneIndex = 0;

  resetInterruptsForChapter();
  updateChapterProgressUI();
}

// ---------------------------------------------------------------------------
// Character & background updates
// ---------------------------------------------------------------------------

/**
 * Resolves situational variant → pose / modifiers from character sheet + flags.
 */
function resolveCharacterVariant(characterId, explicitVariant) {
  const character = charactersData[characterId];
  if (!character) return null;
  if (explicitVariant) return explicitVariant;
  if (!character.situationalVariants) return null;

  // Prefer bedridden over injured when both flags set
  const order = Object.keys(character.situationalVariants);
  const preferred = ['bedridden', 'injured', ...order];
  const seen = new Set();
  for (const variantId of preferred) {
    if (seen.has(variantId) || !character.situationalVariants[variantId]) continue;
    seen.add(variantId);
    const rule = character.situationalVariants[variantId];
    if (!rule?.autoWhen?.flag) continue;
    const expected = rule.autoWhen.value ?? true;
    if (gameState.flags[rule.autoWhen.flag] === expected) {
      return variantId;
    }
  }
  return null;
}

function encodeAssetPath(path) {
  return String(path || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function pickFromModifierTree(node, modifierKeys, modifiers, expression) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node[expression] === 'string') return node[expression];
  if (!modifierKeys?.length) {
    // leaf map of expression → filename
    return node[expression] || node.neutral || Object.values(node).find((v) => typeof v === 'string') || null;
  }
  const [key, ...rest] = modifierKeys;
  const choice = modifiers[key] || Object.keys(node)[0];
  const next = node[choice];
  if (!next) return null;
  if (typeof next === 'string') return next;
  return pickFromModifierTree(next, rest, modifiers, expression);
}

/**
 * Builds ordered PNG paths. Prefer simple ASCII characters/{id}/ files first.
 */
function buildSpriteCandidates(character, expression, variant, options = {}) {
  const candidates = [];
  const spriteId = character.spriteId || character.id;
  const sheet = spritesData.characters?.[spriteId];
  const variantRule = variant && character.situationalVariants?.[variant];

  let pose =
    options.pose ||
    variantRule?.pose ||
    character.defaultPose ||
    sheet?.defaultPose ||
    'normal';

  const modifiers = {
    ...(sheet?.defaultModifiers || {}),
    ...(character.defaultModifiers || {}),
    ...(variantRule?.modifiers || {}),
    ...(options.modifiers || {})
  };

  const expr =
    character.expressions?.includes(expression) ? expression : character.expressionDefault || 'neutral';

  // 1) Simple ASCII runtime copies (most reliable on all browsers / deploys)
  const simpleBase = character.spriteBase || `characters/${spriteId}`;
  if (variant) {
    candidates.push(`${simpleBase}/${variant}_${expr}.png`);
    candidates.push(`${simpleBase}/${variant}.png`);
  }
  if (pose && pose !== 'normal') {
    candidates.push(`${simpleBase}/${pose}_${expr}.png`);
    candidates.push(`${simpleBase}/${pose}_neutral.png`);
  }
  candidates.push(`${simpleBase}/${expr}.png`);
  candidates.push(`${simpleBase}/neutral.png`);
  candidates.push(`${simpleBase}/base.png`);

  // 2) Resources/Art via sprites.json (original artist folder names)
  if (sheet?.poses?.[pose]) {
    const poseData = sheet.poses[pose];
    const folder = poseData.folder;
    const file = pickFromModifierTree(poseData.files, poseData.modifierKeys || [], modifiers, expr);
    if (folder && file) {
      candidates.push(`${folder}/${file}`);
    }
    if (typeof poseData.files?.[expr] === 'string') {
      candidates.push(`${folder}/${poseData.files[expr]}`);
    }
  }

  if (character.spritePath) {
    candidates.unshift(
      character.spritePath
        .replace('{expression}', expr)
        .replace('{variant}', variant || 'default')
        .replace('{pose}', pose)
    );
  }

  return [...new Set(candidates)];
}

function formatSpritePlaceholder(character, expression, variant) {
  const exprLabel = character.expressionLabels?.[expression] || expression;
  const variantLabel =
    variant && character.situationalVariants?.[variant]?.label
      ? ` · ${character.situationalVariants[variant].label}`
      : '';
  return (
    character.textPlaceholder ||
    `[Sprite placeholder] ${character.displayName} · Expression: ${exprLabel}${variantLabel}`
  );
}

/**
 * Tries candidate paths until one loads; otherwise shows text placeholder.
 */
function tryLoadSpriteImage(candidates, onSuccess, onFail) {
  let index = 0;

  function tryNext() {
    if (index >= candidates.length) {
      onFail();
      return;
    }
    const raw = candidates[index++];
    const path = encodeAssetPath(raw);
    const img = new Image();
    img.onload = () => onSuccess(path, raw);
    img.onerror = () => tryNext();
    img.src = path;
  }

  tryNext();
}

function clearCharacterSprite() {
  gameState.currentPose = null;
  gameState.currentModifiers = {};
  characterSpriteEl.classList.remove('has-image', 'is-visible', 'is-placeholder');
  characterSpriteEl.style.backgroundImage = '';
  if (characterSpriteImgEl) {
    characterSpriteImgEl.hidden = true;
    characterSpriteImgEl.removeAttribute('src');
  }
  characterSpriteLabelEl.textContent = '';
  characterSpriteEl.dataset.variant = '';
}

/**
 * Swaps the character sprite (image or text placeholder).
 * @param {string} characterId
 * @param {string} expression
 * @param {{ variant?: string|null, pose?: string|null, modifiers?: object }} [options]
 */
function updateCharacterSprite(characterId, expression, options = {}) {
  gameState.currentCharacter = characterId;
  gameState.currentExpression = expression;

  if (options.pose) {
    gameState.currentPose = options.pose;
  } else if (options.pose === null) {
    // explicit null from scene without pose → clear sticky pose
    gameState.currentPose = null;
  }

  if (options.modifiers) {
    gameState.currentModifiers = { ...options.modifiers };
  } else if (options.modifiers === null) {
    gameState.currentModifiers = {};
  }

  const character = charactersData[characterId];
  if (!character) {
    console.warn(`[updateCharacterSprite] Unknown character: ${characterId}`);
    characterSpriteEl.classList.add('is-visible', 'is-placeholder');
    characterSpriteEl.classList.remove('has-image');
    characterSpriteEl.style.backgroundImage = '';
    characterSpriteLabelEl.textContent = `[Sprite placeholder] ${characterId}`;
    characterSpriteEl.dataset.variant = '';
    return;
  }

  const variant = resolveCharacterVariant(characterId, options.variant ?? null);
  const candidates = buildSpriteCandidates(character, expression, variant, {
    pose: options.pose || null,
    modifiers: options.modifiers || null
  });

  console.log(
    `[updateCharacterSprite] ${character.displayName}, ${expression}${variant ? `, ${variant}` : ''} →`,
    candidates[0] || '(none)'
  );

  characterSpriteEl.dataset.variant = variant || '';
  characterSpriteEl.classList.add('is-visible');
  characterSpriteEl.classList.remove('is-placeholder');

  if (candidates.length === 0) {
    characterSpriteEl.classList.add('is-placeholder');
    characterSpriteEl.classList.remove('has-image');
    characterSpriteEl.style.backgroundImage = '';
    characterSpriteLabelEl.textContent = formatSpritePlaceholder(character, expression, variant);
    return;
  }

  tryLoadSpriteImage(
    candidates,
    (loadedPath) => {
      if (characterSpriteImgEl) {
        characterSpriteImgEl.hidden = false;
        characterSpriteImgEl.src = loadedPath;
      }
      characterSpriteEl.style.backgroundImage = '';
      characterSpriteEl.style.backgroundColor = 'transparent';
      characterSpriteEl.classList.add('has-image');
      characterSpriteEl.classList.remove('is-placeholder');
      characterSpriteLabelEl.textContent = '';
    },
    () => {
      if (characterSpriteImgEl) {
        characterSpriteImgEl.hidden = true;
        characterSpriteImgEl.removeAttribute('src');
      }
      characterSpriteEl.classList.remove('has-image');
      characterSpriteEl.classList.add('is-placeholder');
      characterSpriteEl.style.backgroundImage = '';
      characterSpriteLabelEl.textContent = formatSpritePlaceholder(character, expression, variant);
    }
  );
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
    backgroundLabelEl.textContent = `[BG placeholder] ${backgroundId}`;
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
  if (interactive?.onCompleteResources) {
    Object.entries(interactive.onCompleteResources).forEach(([key, delta]) => {
      if (gameState.resources[key] !== undefined) {
        gameState.resources[key] = clamp(gameState.resources[key] + delta, 0, 99);
      }
    });
  }
}

function setStoryMode(mode) {
  gameState.storyMode = mode;
  dialogueBoxEl.classList.toggle('mode-scripted', mode === 'scripted');
  dialogueBoxEl.classList.toggle('mode-interactive', mode === 'interactive');
  updateInterruptUI();
}

function setChapterSegment(segment) {
  const next = segment === 'B' ? 'B' : 'A';
  gameState.chapterSegment = next;
  gameState.interruptsLeft = next === 'B' ? gameState.interruptsMaxB : gameState.interruptsMaxA;
  updateInterruptUI();
}

function resetInterruptsForChapter() {
  const metaSegment = currentChapterMeta?.segment || 'A';
  setChapterSegment(metaSegment);
}

function updateInterruptUI() {
  const left = Math.max(0, gameState.interruptsLeft | 0);
  const label = `Interrupt ×${left}`;
  if (interruptCountEl) interruptCountEl.textContent = label;
  if (interruptHudEl) {
    interruptHudEl.textContent = label;
    interruptHudEl.hidden = false;
  }
  const canShow =
    gameState.storyMode === 'scripted' &&
    awaitingSceneAdvance &&
    !gameState.isTyping &&
    !gameState.isWaitingForAI &&
    !gameState.interruptMode &&
    left > 0;
  if (interruptBarEl) interruptBarEl.hidden = !canShow;
  if (interruptBtnEl) interruptBtnEl.disabled = !canShow;
}

/** Saved scripted continuation while the player interrupts. */
let interruptResumeCallback = null;

function beginInterrupt() {
  if (gameState.interruptsLeft <= 0) return;
  if (gameState.storyMode !== 'scripted' || !awaitingSceneAdvance) return;
  if (gameState.isTyping || gameState.isWaitingForAI || gameState.interruptMode) return;

  // Keep the scripted "go to next scene" callback — interrupt must restore it later.
  interruptResumeCallback =
    typeof onTypewriterComplete === 'function' ? onTypewriterComplete : interruptResumeCallback;
  onTypewriterComplete = null;

  gameState.interruptsLeft -= 1;
  gameState.interruptMode = true;
  setAwaitingAdvance(false);
  setStoryMode('interactive');

  const interactive = {
    objective: `[Interrupt ×${gameState.interruptsLeft} left] Cut in — talk now`,
    playerPrompt: 'You interrupted the scene. What do you say?',
    suggestions: [],
    maxFreeReplies: 1,
    aiGoal:
      'The player interrupted scripted dialogue. Reply in-character to what they say, stay in the current scene, do not skip major plot beats, do not resolve the chapter. One short reply. Set advanceMainline true.',
    isInterrupt: true,
    advanceSceneIds: []
  };
  gameState.currentInteractive = interactive;
  gameState.interactiveReplyCount = 0;

  storyObjectiveEl.textContent = interactive.objective;
  storyObjectiveEl.hidden = false;
  modeHintEl.textContent = `${interactive.playerPrompt} · Costs 1 interrupt (system talk spots are free)`;
  modeHintEl.hidden = false;
  suggestionChipsEl.hidden = true;
  suggestionChipsEl.innerHTML = '';
  toggleSuggestionsBtnEl.hidden = true;
  advanceMainlineBtnEl.hidden = true;

  updateInterruptUI();
  unlockInput();
  gameState.turn = 'player';
  playerInputEl.focus();
}

function endInterruptAndResumeScript() {
  gameState.interruptMode = false;
  gameState.currentInteractive = null;
  gameState.interactiveReplyCount = 0;
  setStoryMode('scripted');
  suggestionChipsEl.hidden = true;
  toggleSuggestionsBtnEl.hidden = true;
  advanceMainlineBtnEl.hidden = true;
  storyObjectiveEl.hidden = true;

  // Restore the scene continuation that beginInterrupt saved.
  if (typeof interruptResumeCallback === 'function') {
    onTypewriterComplete = interruptResumeCallback;
    interruptResumeCallback = null;
  }

  updateInterruptUI();
  setAwaitingAdvance(true);
  modeHintEl.textContent = 'Interrupt done · click the text or press Space to continue';
  modeHintEl.hidden = false;
  setDialogueTypingCursor(true);
  lockInput();
  gameState.turn = 'npc';
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
    `${interactive.playerPrompt} · System talk is FREE · Tap "Quick actions" to decide; type your own reply for up to ${interactive.maxFreeReplies} free turns`;
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
  toggleSuggestionsBtnEl.hidden = true;
  toggleSuggestionsBtnEl.setAttribute('aria-expanded', 'false');
  advanceMainlineBtnEl.hidden = true;
}

function renderSuggestionChips(suggestions) {
  suggestionChipsEl.innerHTML = '';

  if (!suggestions.length) {
    suggestionChipsEl.hidden = true;
    toggleSuggestionsBtnEl.hidden = true;
    return;
  }

  toggleSuggestionsBtnEl.hidden = false;
  toggleSuggestionsBtnEl.textContent = 'Show quick actions';
  toggleSuggestionsBtnEl.setAttribute('aria-expanded', 'false');

  const label = document.createElement('div');
  label.className = 'suggestion-label';
  label.textContent = '▸ Quick actions (auto-advances after the character responds)';
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
  // Keep suggested choices out of the way until the player asks for them.
  suggestionChipsEl.hidden = true;
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
    left > 0 ? `Continue story → (${left} free ${left === 1 ? 'turn' : 'turns'} left)` : 'Continue story →';
}

/**
 * After interactive beat, play queued mainline scenes.
 */
function endInteractiveAndAdvanceMainline() {
  const interactive = gameState.currentInteractive;
  applyInteractiveCompleteEffects(interactive);

  if (interactive?.isInterrupt || gameState.interruptMode) {
    endInterruptAndResumeScript();
    return;
  }

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
  if (scene.segment === 'A' || scene.segment === 'B') {
    setChapterSegment(scene.segment);
  }
  applySceneEnterEffects(scene);
  updateBackground(scene.background);
  if (window.VNAudio) {
    window.VNAudio.applySceneAudio(scene);
  } else {
    showSoundCue(scene.soundCue);
  }

  if (scene.character) {
    updateCharacterSprite(scene.character, scene.expression || 'neutral', {
      variant: scene.variant ?? null,
      pose: scene.pose ?? null,
      modifiers: scene.modifiers || null
    });
  } else if (scene.speaker && charactersData[scene.speaker]?.role === 'npc') {
    // Speaker-only NPCs (no explicit character field) still show art
    updateCharacterSprite(scene.speaker, scene.expression || 'neutral', {
      variant: scene.variant ?? null,
      pose: scene.pose ?? null,
      modifiers: scene.modifiers || null
    });
  } else if (scene.speaker === 'narrator' || !scene.character && !charactersData[scene.speaker]) {
    clearCharacterSprite();
  }

  if (scene.endingTitle) {
    storyObjectiveEl.hidden = false;
    storyObjectiveEl.textContent = scene.endingTitle;
  }

  const speakerName = resolveSpeakerDisplayName(scene);

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
        handleChapterEnd();
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
      if (scene.chapterEnd) {
        handleChapterEnd();
        return;
      }
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
 * Marks chapter completion flags before optional auto-transition.
 */
function markCurrentChapterComplete() {
  const chapterId = gameState.currentChapter;
  if (chapterId === 'prologue') {
    gameState.flags.prologueComplete = true;
  }
  if (chapterId === 'chapter01_highway') {
    gameState.flags.chapter01Complete = true;
    gameState.flags.highwayArcStarted = true;
  }
  if (chapterId === 'chapter02_towns') {
    gameState.flags.chapter02Complete = true;
    gameState.flags.towerVisible = true;
  }
  if (chapterId === 'chapter03_tower') {
    gameState.flags.chapter03Complete = true;
    gameState.flags.reachedRadioTower = true;
  }
  if (chapterId === 'endings') {
    gameState.flags.endingsComplete = true;
  }
}

/**
 * Ends a chapter; auto-continues when the next chapter file is ready.
 */
function handleChapterEnd() {
  markCurrentChapterComplete();

  const nextId = currentChapterMeta?.nextChapter;
  const nextChapterInfo = storyProgressData?.chapters?.find((c) => c.id === nextId);

  if (nextChapterInfo?.status === 'implemented' && CHAPTER_FILES[nextId]) {
    transitionToNextChapter();
    return;
  }

  showChapterComplete();
}

/**
 * Auto-continue into the next chapter JSON.
 */
async function transitionToNextChapter() {
  const nextId = currentChapterMeta?.nextChapter;
  if (!nextId || !CHAPTER_FILES[nextId]) return;

  await loadChapter(nextId, { resetIndex: true });

  storyObjectiveEl.hidden = false;
  if (nextId === 'endings' && gameState.endingRoute) {
    const routeLabels = {
      hidden: 'Hidden Ending',
      bad: 'Bad Ending',
      normal: 'Normal Ending',
      good: 'Good Ending',
      true: 'True Ending'
    };
    storyObjectiveEl.textContent = `[Ending · ${routeLabels[gameState.endingRoute] || gameState.endingRoute}]`;
  } else {
    storyObjectiveEl.textContent = `[${currentChapterMeta.title}]`;
  }
  modeHintEl.hidden = false;
  modeHintEl.textContent = 'Loading next chapter… click to continue';

  onTypewriterComplete = null;
  playScene(storyScenes[0]);
}

/**
 * Shown when a chapter's last scene finishes.
 */
function showChapterComplete() {
  markCurrentChapterComplete();

  exitInteractiveMode();
  setStoryMode('scripted');
  lockInput();
  updateChapterProgressUI();

  const nextId = currentChapterMeta?.nextChapter;
  const nextChapterInfo = storyProgressData?.chapters?.find((c) => c.id === nextId);

  storyObjectiveEl.hidden = false;
  storyObjectiveEl.textContent = `[${currentChapterMeta?.title || 'Chapter'} · Complete]`;
  modeHintEl.hidden = false;

  if (nextChapterInfo?.status === 'implemented' && CHAPTER_FILES[nextId]) {
    modeHintEl.textContent = 'Next chapter is ready. Refreshing will restart from the prologue; save/load coming soon.';
  } else if (gameState.flags.gameComplete) {
    const route = gameState.endingRoute || gameState.flags.endingAchieved || 'unknown';
    modeHintEl.textContent = `The end (${route}). Refresh to replay from the start, or open PROGRESS.`;
  } else {
    modeHintEl.textContent = `Next chapter "${nextChapterInfo?.title || 'TBD'}" is still in development. Open PROGRESS for the full roadmap.`;
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
    storyObjectiveEl.textContent = `[${chapterEntry.title}] Progress ${step}/${total}`;
  }
}

// ---------------------------------------------------------------------------
// Input lock / unlock
// ---------------------------------------------------------------------------

function lockInput() {
  playerInputEl.disabled = true;
  sendBtnEl.disabled = true;
  playerInputEl.placeholder = 'Waiting…';
  playerInputAreaEl.classList.add('input-locked');
}

function unlockInput() {
  playerInputEl.disabled = false;
  sendBtnEl.disabled = false;
  playerInputEl.placeholder = 'Type your reply…';
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
  updateInterruptUI();
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
      modeHintEl.textContent = 'Click the text or press Space to continue';
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
    modeHintEl.textContent = gameState.currentInteractive?.playerPrompt || 'Type your reply…';
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

  characterNameEl.textContent = characterName || '';
  characterNameEl.hidden = !characterName;
  characterNameEl.classList.toggle('is-narration', !characterName);
  dialogueTextEl.textContent = '';
  currentTypewriterText = text;
  pendingDialogue = skipHistory ? null : { name: characterName || '', text };

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
        updateCharacterSprite(reply.speakerId, expression, {
          variant: resolveCharacterVariant(reply.speakerId, null)
        });
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

      const replyName =
        reply.speakerId === 'narrator' || reply.speakerName === '旁白' || reply.speakerName === 'Narrator'
          ? ''
          : reply.speakerName;
      displayDialogue(replyName, reply.text);
    })
    .catch((error) => {
      console.error('[AI]', error);
      gameState.isWaitingForAI = false;
      gameState.interactiveReplyCount = Math.max(0, gameState.interactiveReplyCount - 1);
      updateAdvanceButtonLabel();

      const scene = storyScenes[storySceneIndex];
      const fallbackId = scene?.character || 'ringo';
      updateCharacterSprite(fallbackId, 'neutral');

      displayDialogue('System', formatAIError(error));
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
        if (gameState.conviction[id] >= 100 && gameState.knotResolved[id] !== undefined) {
          gameState.knotResolved[id] = true;
        }
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
      "The browser couldn't reach the local server (Failed to fetch).",
      '',
      'Please check:',
      '1) npm start is running in your terminal (not npx serve)',
      "2) The address bar shows http://localhost:8765 (don't open index.html directly)",
      "3) If Cursor's built-in browser fails, try Chrome/Edge at that address",
      '4) Restart npm start after editing .env'
    ].join('\n');
  }
  return `AI couldn't respond right now: ${msg}`;
}

async function verifyGameServer() {
  if (window.location.protocol === 'file:') {
    return { ok: false, reason: 'file-protocol' };
  }
  try {
    const response = await VNAuth.apiFetch('/api/ai/status');
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
  html += `<p class="progress-current">Now: ${chapter?.title || '—'} · Beat ${beatIndex >= 0 ? beatIndex + 1 : '?'} / ${chapter?.beats.length || '?'}</p>`;

  storyProgressData.chapters.forEach((ch) => {
    const statusLabel =
      ch.status === 'implemented' ? 'Playable' : ch.status === 'planned' ? 'Planned' : 'Outline';
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

if (interruptBtnEl) {
  interruptBtnEl.addEventListener('click', () => beginInterrupt());
}

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
  <h2 id="settings-title">Settings</h2>
  <div id="settings-content">
    <h3 class="settings-subtitle">Audio</h3>
    <p class="settings-hint">Drop files into <code>audio/bgm/</code> and <code>audio/sfx/</code> using the exact id as the filename. Spec: <code>audio/音频需求.md</code>.</p>
    <label class="settings-hint" for="audio-volume">Volume</label>
    <input type="range" id="audio-volume" min="0" max="100" value="55" style="width:100%;margin:8px 0;" />
    <label class="settings-hint"><input type="checkbox" id="audio-mute" /> Mute</label>
    <p id="audio-library-status">Audio library: Checking…</p>
    <table class="settings-table" id="audio-library">
      <thead><tr><th></th><th>id</th><th>status</th></tr></thead>
      <tbody id="audio-library-body"></tbody>
    </table>

    <p id="ai-status-line">AI status: Checking…</p>
    <p id="ai-model-line"></p>

    <h3 class="settings-subtitle">What API do you need?</h3>
    <p class="settings-hint">
      <strong>Cursor membership can't power the game.</strong> Cursor Pro is editor AI—it doesn't plug into this project.<br>
      This game is in English. Prefer <strong>DeepSeek</strong> (or OpenAI). Zhipu glm-4-flash often answers in Chinese even with English prompts.
    </p>

    <table class="settings-table">
      <thead><tr><th>Platform</th><th>Best for</th><th>Sign up</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>DeepSeek</strong></td>
          <td>Best pick for English VN; cheap</td>
          <td>platform.deepseek.com</td>
        </tr>
        <tr>
          <td><strong>Kimi / Moonshot</strong></td>
          <td>OK bilingual; fine if you already use it</td>
          <td>platform.moonshot.cn</td>
        </tr>
        <tr>
          <td>OpenAI</td>
          <td>Stable English; needs foreign payment</td>
          <td>platform.openai.com</td>
        </tr>
        <tr>
          <td>Zhipu AI</td>
          <td>Free glm-4-flash; tends toward Chinese</td>
          <td>open.bigmodel.cn</td>
        </tr>
      </tbody>
    </table>

    <h3 class="settings-subtitle">Setup (one-time)</h3>
    <ol class="settings-steps">
      <li>Open the <code>.env</code> file in the project root</li>
      <li>Paste your key after <code>AI_API_KEY=</code></li>
      <li>Set <code>AI_BASE_URL</code> + <code>AI_MODEL</code> (DeepSeek example is in <code>.env.example</code>)</li>
      <li>Run <code>npm start</code> to restart (or update Cloudflare secrets + redeploy)</li>
      <li>Click "Check again" below to confirm you're connected</li>
    </ol>

    <p class="settings-hint">Never share your .env or commit it to git.</p>
    <button type="button" id="ai-recheck-btn" class="settings-action-btn">Check again</button>
  </div>
`;
gameContentEl.appendChild(settingsPanelEl);

const aiStatusLineEl = document.getElementById('ai-status-line');
const aiModelLineEl = document.getElementById('ai-model-line');

async function refreshAIStatus() {
  aiStatusLineEl.textContent = 'AI status: Checking…';
  aiModelLineEl.textContent = '';

  if (window.location.protocol === 'file:') {
    aiStatusLineEl.textContent = 'AI status: Unavailable (use npm start)';
    aiModelLineEl.textContent = "Don't open index.html directly";
    return;
  }

  try {
    const status = await AI.getStatus();
    if (status.configured) {
      aiStatusLineEl.textContent = 'AI status: Connected ✓';
      aiModelLineEl.textContent = `Model: ${status.model} · ${window.location.origin}`;
    } else {
      aiStatusLineEl.textContent = 'AI status: Not configured (missing AI_API_KEY)';
      aiModelLineEl.textContent = 'Copy .env.example → .env and add your API key';
    }
  } catch {
    aiStatusLineEl.textContent = "AI status: Can't reach server";
    aiModelLineEl.textContent = `Make sure npm start is running, then open ${window.location.protocol}//${window.location.hostname}:8765`;
  }
}

async function refreshAudioLibrary() {
  const statusEl = document.getElementById('audio-library-status');
  const bodyEl = document.getElementById('audio-library-body');
  if (!statusEl || !bodyEl || !window.VNAudio?.refreshInventory) return;

  statusEl.textContent = 'Audio library: Checking…';
  try {
    await window.VNAudio.refreshInventory();
    const { catalog: liveCatalog, inventory: liveInventory } = window.VNAudio.getInventory();
    const rows = [];
    let found = 0;
    let total = 0;
    for (const kind of ['bgm', 'sfx']) {
      for (const entry of liveCatalog[kind] || []) {
        const item = liveInventory[kind]?.[entry.id] || { id: entry.id, found: false };
        total += 1;
        if (item.found) found += 1;
        const statusClass = item.found ? 'audio-found' : 'audio-missing';
        const statusText = item.found ? 'FOUND' : 'MISSING';
        rows.push(`<tr><td>${kind.toUpperCase()}</td><td><code>${item.id}</code></td><td class="${statusClass}">${statusText}</td></tr>`);
      }
    }
    bodyEl.innerHTML = rows.join('') || '<tr><td colspan="3">No audio catalog</td></tr>';
    statusEl.textContent = `Audio library: ${found} / ${total} files found. Drop mp3s into audio/bgm or audio/sfx, then reopen Settings.`;
  } catch {
    statusEl.textContent = 'Audio library: Could not scan files';
  }
}

function toggleSettingsPanel() {
  if (settingsPanelEl.hidden) {
    settingsPanelEl.hidden = false;
    refreshAIStatus();
    refreshAudioLibrary();
  } else {
    settingsPanelEl.hidden = true;
  }
}

document.getElementById('settings-panel-close').addEventListener('click', () => {
  settingsPanelEl.hidden = true;
});

document.getElementById('ai-recheck-btn').addEventListener('click', refreshAIStatus);

const audioVolumeEl = document.getElementById('audio-volume');
const audioMuteEl = document.getElementById('audio-mute');
if (audioVolumeEl && window.VNAudio) {
  audioVolumeEl.addEventListener('input', () => {
    window.VNAudio.setVolume(Number(audioVolumeEl.value) / 100);
  });
}
if (audioMuteEl && window.VNAudio) {
  audioMuteEl.addEventListener('change', () => {
    window.VNAudio.setMuted(audioMuteEl.checked);
  });
}

// ---------------------------------------------------------------------------
// Page load — load data and start prologue
// ---------------------------------------------------------------------------

advanceMainlineBtnEl.addEventListener('click', () => {
  if (gameState.storyMode !== 'interactive' || gameState.isTyping || gameState.isWaitingForAI) return;
  endInteractiveAndAdvanceMainline();
});

toggleSuggestionsBtnEl.addEventListener('click', () => {
  const willShow = suggestionChipsEl.hidden;
  suggestionChipsEl.hidden = !willShow;
  toggleSuggestionsBtnEl.textContent = willShow ? 'Hide quick actions' : 'Show quick actions';
  toggleSuggestionsBtnEl.setAttribute('aria-expanded', String(willShow));
});

loadGameData()
  .then(async () => {
    setStoryMode('scripted');
    updateBackground(gameState.currentBackground);

    const serverCheck = await verifyGameServer();
    if (!serverCheck.ok) {
      displayDialogue(
        'System',
        serverCheck.reason === 'file-protocol'
          ? "Run npm start, then open http://localhost:8765 in your browser. Opening index.html directly won't work with AI."
          : formatAIError(new Error('Failed to fetch'))
      );
      return;
    }

    playScene(storyScenes[0]);
  })
  .catch((error) => {
    console.error(error);
    displayDialogue(
      'System',
      "Couldn't load story data (needs a local server—don't use file://). Run npx serve and refresh."
    );
  });
