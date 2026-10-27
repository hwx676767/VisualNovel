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
  /** Handheld life icons (3 max). Conservative — only story flags change this later. */
  hearts: 3,
  currentPose: null,
  currentModifiers: {}
};

/** Scene ids queued after interactive beat ends */
let advanceSceneQueue = [];

/** Next player input is a decisive action (from chip or matching suggestion). */
let pendingInputIsDecisive = false;

/** Loaded content registries */
let backgroundsData = {};
let atmospheresData = { presets: {} };
let charactersData = {};
let spritesData = { characters: {} };
let storyScenes = [];
let storySceneIndex = 0;
let currentChapterMeta = null;
let storyProgressData = null;
let currentAtmosphereId = 'neutral';

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
const stageLayerEl = document.getElementById('stage-layer');
const atmosphereLayerEl = document.getElementById('atmosphere-layer');
const gameContentEl = document.getElementById('game-canvas');
const characterNameEl = document.getElementById('character-name');
const dialogueTextEl = document.getElementById('dialogue-text');
const dialogueBoxEl = document.getElementById('dialogue-box');
const clickContinueEl = document.getElementById('click-continue');
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
const handheldDockEl = document.getElementById('handheld-dock');
const handheldInterruptCountEl = document.getElementById('handheld-interrupt-count');
const handheldHeartsEl = document.getElementById('handheld-hearts');
const handheldSelectorEl = document.getElementById('handheld-selector');
const handheldSlots = Array.from(document.querySelectorAll('.handheld-slot'));

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
  if (scene.uiMode === 'explore' || scene.mode === 'explore') return 'EXPLORE';
  if (scene.speaker === 'narrator') return '';
  const name = scene.speakerName;
  if (name === '旁白' || name === 'Narrator') return '';
  if (name) return name;
  return charactersData[scene.speaker]?.displayName || scene.speaker || '';
}

/**
 * Nameplate color classes for scrapbook UI.
 */
function applyNameplateStyle(displayName, speakerId = '') {
  if (!characterNameEl) return;
  characterNameEl.classList.remove(
    'name-xian',
    'name-ringo',
    'name-miles',
    'name-you',
    'name-other',
    'name-explore'
  );

  const id = String(speakerId || '').toLowerCase();
  const key = String(displayName || '').trim().toLowerCase();

  if (key === 'explore' || id === 'explore') {
    characterNameEl.classList.add('name-explore');
    return;
  }
  if (id === 'xian' || key === 'xian') {
    characterNameEl.classList.add('name-xian');
    return;
  }
  if (id === 'ringo' || key === 'ringo') {
    characterNameEl.classList.add('name-ringo');
    return;
  }
  if (id === 'miles' || key === 'miles') {
    characterNameEl.classList.add('name-miles');
    return;
  }
  if (id === 'player' || key === 'you' || key === 'player') {
    characterNameEl.classList.add('name-you');
    return;
  }
  if (displayName) characterNameEl.classList.add('name-other');
}

function clampHearts(value) {
  const n = typeof value === 'number' ? value : 3;
  return Math.max(0, Math.min(3, Math.round(n * 2) / 2));
}

function applyHeartsDelta(delta) {
  if (typeof delta !== 'number' || !delta) return;
  gameState.hearts = clampHearts((typeof gameState.hearts === 'number' ? gameState.hearts : 3) + delta);
  updateHeartsUI();
}

function applyEffectBag(effects) {
  if (!effects || typeof effects !== 'object') return;
  if (typeof effects.hearts === 'number') applyHeartsDelta(effects.hearts);
  if (effects.flags) Object.assign(gameState.flags, effects.flags);
  if (effects.resources) {
    Object.entries(effects.resources).forEach(([key, delta]) => {
      if (gameState.resources[key] !== undefined && typeof delta === 'number') {
        gameState.resources[key] = clamp(gameState.resources[key] + delta, 0, 99);
      }
    });
  }
}

function updateHeartsUI() {
  if (!handheldHeartsEl) return;
  let hearts = clampHearts(typeof gameState.hearts === 'number' ? gameState.hearts : 3);
  if (gameState.flags?.xianAlive === false) hearts = 0;
  const imgs = handheldHeartsEl.querySelectorAll('.heart');
  imgs.forEach((img, index) => {
    const filled = hearts - index;
    img.classList.remove('is-full', 'is-half', 'is-empty');
    if (filled >= 1) {
      img.classList.add('is-full');
      img.src = 'ui/heart.png';
    } else if (filled >= 0.5) {
      img.classList.add('is-half');
      img.src = 'ui/heart_half.png';
    } else {
      img.classList.add('is-empty');
      img.src = 'ui/heart_empty.png';
    }
  });
}

function moveHandheldSelector(slotEl) {
  if (!handheldSelectorEl || !slotEl || !slotEl.parentElement) return;
  handheldSlots.forEach((slot) => slot.classList.toggle('is-selected', slot === slotEl));
  const parent = slotEl.parentElement.getBoundingClientRect();
  const icon = slotEl.querySelector('img');
  const box = (icon || slotEl).getBoundingClientRect();
  // Fit tightly around the icon (was oversized at ~1.15× slot).
  const width = Math.max(22, Math.min(box.width, box.height) * 1.08);
  handheldSelectorEl.hidden = false;
  handheldSelectorEl.style.width = `${width}px`;
  handheldSelectorEl.style.left = `${box.left - parent.left + (box.width - width) / 2}px`;
  handheldSelectorEl.style.top = `${box.top - parent.top + (box.height - width) / 2}px`;
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
  const [backgrounds, atmospheres, characters, sprites, savedState, prologue, progress] = await Promise.all([
    loadJson('data/backgrounds.json'),
    loadJson('data/atmospheres.json'),
    loadJson('data/characters.json'),
    loadJson('data/sprites.json'),
    loadJson('data/gameState.json'),
    loadJson('data/story/prologue.json'),
    loadJson('data/story/progress.json')
  ]);

  backgrounds.backgrounds.forEach((bg) => {
    backgroundsData[bg.id] = bg;
  });

  atmospheresData = atmospheres && atmospheres.presets ? atmospheres : { presets: {} };

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
  preloadCommonSprites();
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

/** Resolved sprite URL cache: avoids re-probing 404s on every line. */
const spritePathCache = new Map();
let spriteLoadToken = 0;

function spriteCacheKey(characterId, expression, variant, pose, modifiers) {
  return [
    characterId,
    expression || '',
    variant || '',
    pose || '',
    modifiers ? JSON.stringify(modifiers) : ''
  ].join('|');
}

/**
 * Builds ordered PNG paths. Prefer simple ASCII characters/{id}/ files first.
 * Most-likely hits first so we rarely wait on sequential 404s.
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

  const simpleBase = character.spriteBase || `characters/${spriteId}`;
  const useAsciiRuntime = String(simpleBase).startsWith('characters/');

  // Likely runtime files first (deployed ASCII copies)
  if (variant) {
    candidates.push(`${simpleBase}/${variant}_${expr}.png`);
    candidates.push(`${simpleBase}/${variant}_neutral.png`);
    candidates.push(`${simpleBase}/${variant}.png`);
  }
  if (pose && pose !== 'normal') {
    candidates.push(`${simpleBase}/${pose}_${expr}.png`);
    candidates.push(`${simpleBase}/${pose}_neutral.png`);
  }
  candidates.push(`${simpleBase}/${expr}.png`);
  if (expr !== 'neutral') candidates.push(`${simpleBase}/neutral.png`);
  candidates.push(`${simpleBase}/base.png`);

  // Local artist folders only as fallback (not on Cloudflare — skip when using characters/)
  if (!useAsciiRuntime && sheet?.poses?.[pose]) {
    const poseData = sheet.poses[pose];
    const folder = poseData.folder;
    const file = pickFromModifierTree(poseData.files, poseData.modifierKeys || [], modifiers, expr);
    if (folder && file) candidates.push(`${folder}/${file}`);
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
 * Loads first working candidate. Cache hits first; races a small batch so
 * missing files don't serialize into a long blank/placeholder flash.
 */
function tryLoadSpriteImage(candidates, onSuccess, onFail) {
  if (!candidates.length) {
    onFail();
    return;
  }

  const paths = candidates.map((raw) => ({ raw, path: encodeAssetPath(raw) }));
  let settled = false;
  let pending = 0;
  let started = 0;
  const CONCURRENCY = 3;

  function pump() {
    while (pending < CONCURRENCY && started < paths.length && !settled) {
      const entry = paths[started++];
      pending += 1;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        pending -= 1;
        if (settled) return;
        settled = true;
        const done = () => onSuccess(entry.path, entry.raw);
        if (typeof img.decode === 'function') {
          img.decode().then(done).catch(done);
        } else {
          done();
        }
      };
      img.onerror = () => {
        pending -= 1;
        if (settled) return;
        if (started < paths.length) {
          pump();
        } else if (pending === 0) {
          onFail();
        }
      };
      img.src = entry.path;
    }
  }

  pump();
}

function clearCharacterSprite() {
  spriteLoadToken += 1;
  gameState.currentPose = null;
  gameState.currentModifiers = {};
  characterSpriteEl.classList.remove('has-image', 'is-visible', 'is-placeholder', 'is-loading');
  characterSpriteEl.style.backgroundImage = '';
  if (characterSpriteImgEl) {
    characterSpriteImgEl.hidden = true;
    characterSpriteImgEl.removeAttribute('src');
  }
  characterSpriteLabelEl.textContent = '';
  characterSpriteEl.dataset.variant = '';
}

function showSpritePlaceholder(character, expression, variant) {
  characterSpriteEl.classList.add('is-visible', 'is-placeholder');
  characterSpriteEl.classList.remove('has-image', 'is-loading');
  characterSpriteEl.style.backgroundImage = '';
  if (characterSpriteImgEl) {
    characterSpriteImgEl.hidden = true;
    characterSpriteImgEl.removeAttribute('src');
  }
  characterSpriteLabelEl.textContent = character
    ? formatSpritePlaceholder(character, expression, variant)
    : `[Sprite placeholder]`;
}

/**
 * Swaps the character sprite (image or text placeholder).
 * Keeps the previous portrait until the next one is ready — no blue flash box.
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
    showSpritePlaceholder(null, expression, null);
    characterSpriteLabelEl.textContent = `[Sprite placeholder] ${characterId}`;
    characterSpriteEl.dataset.variant = '';
    return;
  }

  const variant = resolveCharacterVariant(characterId, options.variant ?? null);
  const poseForKey = options.pose || character.situationalVariants?.[variant]?.pose || null;
  const cacheKey = spriteCacheKey(
    characterId,
    expression,
    variant,
    poseForKey,
    options.modifiers || null
  );

  const candidates = buildSpriteCandidates(character, expression, variant, {
    pose: options.pose || null,
    modifiers: options.modifiers || null
  });

  characterSpriteEl.dataset.variant = variant || '';

  if (candidates.length === 0) {
    showSpritePlaceholder(character, expression, variant);
    return;
  }

  const loadId = ++spriteLoadToken;
  const keepPrevious = characterSpriteEl.classList.contains('has-image');

  // Never flash the blue placeholder while loading — hold old art or stay hidden
  characterSpriteEl.classList.remove('is-placeholder');
  characterSpriteEl.classList.add('is-loading');
  if (!keepPrevious) {
    characterSpriteEl.classList.remove('is-visible');
  }

  const applyLoaded = (loadedPath, rawPath) => {
    if (loadId !== spriteLoadToken) return;
    spritePathCache.set(cacheKey, rawPath || loadedPath);
    if (characterSpriteImgEl) {
      characterSpriteImgEl.hidden = false;
      characterSpriteImgEl.src = loadedPath;
    }
    characterSpriteEl.style.backgroundImage = '';
    characterSpriteEl.style.backgroundColor = 'transparent';
    characterSpriteEl.classList.add('has-image', 'is-visible');
    characterSpriteEl.classList.remove('is-placeholder', 'is-loading');
    characterSpriteLabelEl.textContent = '';
  };

  const cachedRaw = spritePathCache.get(cacheKey);
  const ordered = cachedRaw
    ? [cachedRaw, ...candidates.filter((c) => c !== cachedRaw)]
    : candidates;

  tryLoadSpriteImage(
    ordered,
    applyLoaded,
    () => {
      if (loadId !== spriteLoadToken) return;
      spritePathCache.delete(cacheKey);
      showSpritePlaceholder(character, expression, variant);
    }
  );
}

/**
 * Warm browser cache for party + early-chapter faces so first lines don't wait on PNG.
 */
function preloadSpriteUrls(urls) {
  const unique = [...new Set(urls.filter(Boolean))];
  unique.forEach((raw) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = encodeAssetPath(raw);
  });
}

function preloadCommonSprites() {
  const warm = [];
  const partyIds = ['xian', 'ringo', 'miles', 'teacher', 'shooter', 'bystander', 'gunshot_npc3'];
  for (const id of partyIds) {
    const character = charactersData[id];
    if (!character) continue;
    const base = character.spriteBase || `characters/${character.spriteId || id}`;
    const exprs = character.expressions?.slice(0, 6) || ['neutral'];
    for (const expr of exprs) {
      warm.push(`${base}/${expr}.png`);
    }
    warm.push(`${base}/neutral.png`, `${base}/base.png`);
    if (id === 'xian') {
      warm.push(`${base}/injured_neutral.png`, `${base}/injured.png`);
    }
    if (id === 'ringo') {
      warm.push(`${base}/protect_neutral.png`, `${base}/protect_resolute.png`);
    }
  }
  preloadSpriteUrls(warm);
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

/**
 * Resolves atmosphere id: scene.atmosphere > background default > neutral.
 * Scene may pass a string id or { id, intensity }.
 */
function resolveAtmosphereId(scene, backgroundId) {
  const raw = scene?.atmosphere;
  if (typeof raw === 'string' && raw) return raw;
  if (raw && typeof raw === 'object' && raw.id) return raw.id;
  const bg = backgroundsData[backgroundId || gameState.currentBackground];
  return bg?.atmosphere || 'neutral';
}

/**
 * Applies CSS color grade + vignette over the stage (not the dialogue UI).
 * @param {string|object|null} atmosphere
 */
function updateAtmosphere(atmosphere) {
  if (!stageLayerEl || !atmosphereLayerEl) return;

  let id = 'neutral';
  let intensity = 1;
  if (typeof atmosphere === 'string') {
    id = atmosphere || 'neutral';
  } else if (atmosphere && typeof atmosphere === 'object') {
    id = atmosphere.id || 'neutral';
    if (typeof atmosphere.intensity === 'number') {
      intensity = Math.min(1.4, Math.max(0, atmosphere.intensity));
    }
  }

  const preset = atmospheresData.presets?.[id] || atmospheresData.presets?.neutral;
  if (!preset) return;

  currentAtmosphereId = id;
  stageLayerEl.style.filter = preset.filter && preset.filter !== 'none' ? preset.filter : '';
  atmosphereLayerEl.style.background = preset.overlay || 'transparent';
  atmosphereLayerEl.style.mixBlendMode = preset.blend || 'soft-light';
  atmosphereLayerEl.style.opacity = String(Math.min(1, 0.35 + intensity * 0.65));
  const vignette = (typeof preset.vignette === 'number' ? preset.vignette : 0) * intensity;
  atmosphereLayerEl.style.setProperty('--atmosphere-vignette', String(vignette));
  stageLayerEl.dataset.atmosphere = id;
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
  if (typeof scene.onEnterHearts === 'number') {
    applyHeartsDelta(scene.onEnterHearts);
  }
  if (scene.onEnterEffects) {
    applyEffectBag(scene.onEnterEffects);
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
  if (typeof interactive?.onCompleteHearts === 'number') {
    applyHeartsDelta(interactive.onCompleteHearts);
  }
  if (interactive?.onCompleteEffects) {
    applyEffectBag(interactive.onCompleteEffects);
  }
}

function setStoryMode(mode) {
  gameState.storyMode = mode;
  dialogueBoxEl.classList.toggle('mode-scripted', mode === 'scripted');
  dialogueBoxEl.classList.toggle('mode-interactive', mode === 'interactive');
  dialogueBoxEl.classList.toggle('mode-explore', mode === 'explore');
  dialogueBoxEl.classList.toggle('is-explore', mode === 'explore');
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
  if (handheldInterruptCountEl) handheldInterruptCountEl.textContent = String(left);
  if (interruptHudEl) {
    interruptHudEl.textContent = label;
    interruptHudEl.hidden = true;
  }
  const canInterrupt =
    gameState.storyMode === 'scripted' &&
    awaitingSceneAdvance &&
    !gameState.isTyping &&
    !gameState.isWaitingForAI &&
    !gameState.interruptMode &&
    left > 0;
  if (interruptBarEl) interruptBarEl.hidden = true;
  if (interruptBtnEl) interruptBtnEl.disabled = !canInterrupt;
  const interruptSlot = document.querySelector('.slot-interrupt');
  if (interruptSlot) interruptSlot.disabled = !canInterrupt;
  updateHeartsUI();
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

function goToSceneById(sceneId) {
  const idx = storyScenes.findIndex((s) => s.id === sceneId);
  if (idx < 0) {
    console.warn('[VN] Missing scene:', sceneId);
    return false;
  }
  storySceneIndex = idx;
  playScene(storyScenes[idx]);
  return true;
}

function enterInteractiveMode(interactive) {
  gameState.currentInteractive = interactive;
  gameState.interactiveReplyCount = 0;
  setStoryMode('interactive');

  storyObjectiveEl.textContent = interactive.objective;
  storyObjectiveEl.hidden = false;
  modeHintEl.textContent =
    `${interactive.playerPrompt} · Type a reply, or open Choices (${interactive.maxFreeReplies} free turns)`;
  modeHintEl.hidden = false;

  // Choices stay collapsed until the player clicks "Show choices".
  renderSuggestionChips(interactive.suggestions || [], { alwaysShow: false, explore: false });
  setChoicesExpanded(false);
  advanceMainlineBtnEl.hidden = false;
  updateAdvanceButtonLabel();
  setDialogueReplyBusy(false);
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

/**
 * Explore beat: clickable choices in the notepad (no AI).
 */
function enterExploreMode(explore) {
  if (!explore?.choices?.length) return;
  gameState.currentInteractive = null;
  setStoryMode('explore');
  setAwaitingAdvance(false);

  const prompt = explore.prompt || 'What do you do?';
  storyObjectiveEl.textContent = explore.objective || '[Explore]';
  storyObjectiveEl.hidden = false;
  modeHintEl.textContent = prompt;
  modeHintEl.hidden = false;
  advanceMainlineBtnEl.hidden = true;
  toggleSuggestionsBtnEl.hidden = true;

  renderExploreChoices(explore.choices);
  fitDialogueText();
}

function renderExploreChoices(choices) {
  suggestionChipsEl.innerHTML = '';
  suggestionChipsEl.hidden = false;
  suggestionChipsEl.classList.remove('is-collapsed');
  suggestionChipsEl.classList.add('is-explore-choices');
  suggestionChipsEl.setAttribute('aria-hidden', 'false');

  const label = document.createElement('div');
  label.className = 'suggestion-label';
  label.textContent = '▸ Choose an action';
  suggestionChipsEl.appendChild(label);

  choices.forEach((choice, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'suggestion-chip explore-choice';
    chip.textContent = choice.label || choice.text || `Option ${index + 1}`;
    chip.addEventListener('click', () => handleExploreChoice(choice));
    suggestionChipsEl.appendChild(chip);
  });
}

function handleExploreChoice(choice) {
  if (gameState.storyMode !== 'explore' || gameState.isTyping) return;
  applyEffectBag(choice.effects);
  if (typeof choice.hearts === 'number') applyHeartsDelta(choice.hearts);
  if (choice.flags) Object.assign(gameState.flags, choice.flags);
  if (choice.resources) applyEffectBag({ resources: choice.resources });

  suggestionChipsEl.innerHTML = '';
  suggestionChipsEl.hidden = true;
  suggestionChipsEl.classList.remove('is-explore-choices');
  storyObjectiveEl.hidden = true;
  modeHintEl.hidden = true;

  const nextId = choice.goto || choice.next || choice.sceneId;
  if (nextId) {
    goToSceneById(nextId);
    return;
  }
  // Fall through to next scene in chapter list
  setStoryMode('scripted');
  if (storySceneIndex < storyScenes.length - 1) {
    storySceneIndex += 1;
    playScene(storyScenes[storySceneIndex]);
  }
}

/**
 * Interactive choice list: collapsed by default; only expand when player toggles.
 */
function setChoicesExpanded(expanded) {
  if (!suggestionChipsEl || !toggleSuggestionsBtnEl) return;
  const open = Boolean(expanded);
  suggestionChipsEl.hidden = !open;
  suggestionChipsEl.classList.toggle('is-collapsed', !open);
  suggestionChipsEl.setAttribute('aria-hidden', String(!open));
  toggleSuggestionsBtnEl.setAttribute('aria-expanded', String(open));
  toggleSuggestionsBtnEl.textContent = open ? '▾ Hide choices' : '▸ Show choices';
}

/**
 * While AI is thinking / NPC is typing, free the notepad for dialogue text.
 */
function setDialogueReplyBusy(busy) {
  if (dialogueBoxEl) dialogueBoxEl.classList.toggle('is-replying', Boolean(busy));
  if (!busy) return;
  setChoicesExpanded(false);
}

function renderSuggestionChips(suggestions, options = {}) {
  suggestionChipsEl.innerHTML = '';
  suggestionChipsEl.classList.remove('is-explore-choices');

  if (!suggestions.length) {
    suggestionChipsEl.hidden = true;
    suggestionChipsEl.classList.add('is-collapsed');
    toggleSuggestionsBtnEl.hidden = true;
    return;
  }

  const label = document.createElement('div');
  label.className = 'suggestion-label';
  label.textContent = options.explore
    ? '▸ Explore actions'
    : '▸ Choices (click one to decide)';
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

  // Always show the toggle; list starts collapsed unless explicitly requested.
  toggleSuggestionsBtnEl.hidden = false;
  setChoicesExpanded(Boolean(options.alwaysShow));
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
  // Compact label — button sits beside the input, not a full-width row.
  advanceMainlineBtnEl.textContent = left > 0 ? `Continue ×${left}` : 'Continue →';
  advanceMainlineBtnEl.title =
    left > 0 ? `Continue story (${left} free ${left === 1 ? 'turn' : 'turns'} left)` : 'Continue story';
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
  updateAtmosphere(scene.atmosphere || resolveAtmosphereId(scene, scene.background));
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
  const isExplore = Boolean(
    scene.explore?.choices?.length ||
    scene.uiMode === 'explore' ||
    scene.mode === 'explore'
  );
  const dialogueOptions = {
    explore: isExplore,
    speakerId: isExplore ? 'explore' : scene.character || scene.speaker || ''
  };

  // Explore hub: show text, then clickable choices (no AI)
  if (scene.explore?.choices?.length) {
    onTypewriterCompleteAfterPlayerLine = null;
    awaitingSceneAdvance = false;
    onTypewriterComplete = () => {
      enterExploreMode(scene.explore);
    };
    setStoryMode('scripted');
    displayDialogue(isExplore ? 'EXPLORE' : speakerName, scene.text, false, dialogueOptions);
    updateChapterProgressUI();
    return;
  }

  if (scene.playerTurn) {
    onTypewriterComplete = null;
    awaitingSceneAdvance = false;

    if (scene.interactive) {
      onTypewriterCompleteAfterPlayerLine = () => enterInteractiveMode(scene.interactive);
    } else {
      onTypewriterCompleteAfterPlayerLine = null;
      setStoryMode('interactive');
    }

    displayDialogue(speakerName, scene.text, false, dialogueOptions);
    updateChapterProgressUI();
    return;
  }

  setStoryMode('scripted');
  onTypewriterCompleteAfterPlayerLine = null;

  const advanceToNext = () => {
    if (scene.next) {
      goToSceneById(scene.next);
      return;
    }
    if (scene.chapterEnd) {
      handleChapterEnd();
      return;
    }
    if (storySceneIndex < storyScenes.length - 1) {
      storySceneIndex += 1;
      playScene(storyScenes[storySceneIndex]);
    }
  };

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
      if (scene.next) {
        goToSceneById(scene.next);
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
      if (scene.id === 'prologue_closing') {
        transitionToNextChapter();
        return;
      }
      advanceToNext();
    };
  }

  awaitingSceneAdvance = false;
  displayDialogue(speakerName, scene.text, false, dialogueOptions);
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

  if (!storyObjectiveEl.hidden && (gameState.storyMode === 'interactive' || gameState.storyMode === 'explore')) {
    return;
  }

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

/**
 * Keep notepad size fixed — shrink font until text fits the inner area.
 */
function fitDialogueText() {
  if (!dialogueTextEl) return;
  const styles = getComputedStyle(document.documentElement);
  const maxPx = parseFloat(styles.getPropertyValue('--dialogue-font-max')) || 18;
  const minPx = parseFloat(styles.getPropertyValue('--dialogue-font-min')) || 10;
  let size = maxPx;
  dialogueTextEl.style.fontSize = `${size}px`;

  // Guard against missing layout during first paint.
  if (dialogueTextEl.clientHeight < 8) {
    requestAnimationFrame(() => fitDialogueText());
    return;
  }

  let guard = 48;
  while (guard-- > 0 && size > minPx && dialogueTextEl.scrollHeight > dialogueTextEl.clientHeight + 1) {
    size -= 0.5;
    dialogueTextEl.style.fontSize = `${size}px`;
  }
}

function setAwaitingAdvance(waiting) {
  awaitingSceneAdvance = waiting;
  dialogueTextEl.classList.toggle('awaiting-advance', waiting);
  if (clickContinueEl) clickContinueEl.hidden = !waiting;
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
  fitDialogueText();

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
    setDialogueReplyBusy(false);
    unlockInput();
    modeHintEl.textContent = gameState.currentInteractive?.playerPrompt
      ? `${gameState.currentInteractive.playerPrompt} · Type a reply, or open Choices`
      : 'Type your reply…';
    modeHintEl.hidden = false;
    playerInputEl.focus();
    return;
  }

  gameState.turn = 'player';
  setDialogueReplyBusy(false);
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

function displayDialogue(characterName, text, skipHistory = false, options = {}) {
  clearTypewriter();
  if (readDelayTimer) {
    clearTimeout(readDelayTimer);
    readDelayTimer = null;
  }
  setAwaitingAdvance(false);
  if (gameState.storyMode !== 'interactive') {
    modeHintEl.hidden = true;
  }

  const isExplore = Boolean(options.explore);
  if (dialogueBoxEl) dialogueBoxEl.classList.toggle('is-explore', isExplore);

  characterNameEl.textContent = characterName || '';
  characterNameEl.hidden = !characterName;
  characterNameEl.classList.toggle('is-narration', !characterName);
  applyNameplateStyle(characterName, options.speakerId || (isExplore ? 'explore' : ''));
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
    fitDialogueText();

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
  // Keep current dialogue visible — don't replace it with "…" while waiting.
  setDialogueReplyBusy(true);
  if (modeHintEl) {
    modeHintEl.hidden = false;
    modeHintEl.textContent = 'Waiting for reply…';
  }

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
        onTypewriterComplete = () => {
          setDialogueReplyBusy(false);
          endInteractiveAndAdvanceMainline();
        };
      } else {
        onTypewriterComplete = null;
        onTypewriterCompleteAfterPlayerLine = () => {
          setDialogueReplyBusy(false);
          if (modeHintEl && gameState.currentInteractive?.playerPrompt) {
            modeHintEl.hidden = false;
            modeHintEl.textContent =
              `${gameState.currentInteractive.playerPrompt} · Type a reply, or open Choices`;
          }
        };
      }

      const replyName =
        reply.speakerId === 'narrator' || reply.speakerName === '旁白' || reply.speakerName === 'Narrator'
          ? ''
          : reply.speakerName;
      // Still busy while typewriter runs so choices can't cover the reply.
      setDialogueReplyBusy(true);
      displayDialogue(replyName, reply.text, false, { speakerId: reply.speakerId || '' });
    })
    .catch((error) => {
      console.error('[AI]', error);
      gameState.isWaitingForAI = false;
      gameState.interactiveReplyCount = Math.max(0, gameState.interactiveReplyCount - 1);
      updateAdvanceButtonLabel();
      setDialogueReplyBusy(false);

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
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
    const response = await VNAuth.apiFetch('/api/ai/status', controller ? { signal: controller.signal } : undefined);
    if (timer) clearTimeout(timer);
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
    if (typeof settingsPanelEl !== 'undefined' && settingsPanelEl) settingsPanelEl.hidden = true;
  } else {
    logPanelEl.hidden = true;
  }
  if (typeof syncHandheldDockOpen === 'function') syncHandheldDockOpen();
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
  if (typeof syncHandheldDockOpen === 'function') syncHandheldDockOpen();
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

function handleHandheldAction(action, slotEl) {
  if (slotEl) moveHandheldSelector(slotEl);
  if (handheldDockEl) handheldDockEl.classList.add('is-open');

  if (action === 'interrupt') {
    beginInterrupt();
    return;
  }
  if (action === 'log') {
    toggleLogPanel();
    return;
  }
  if (action === 'settings') {
    toggleSettingsPanel();
  }
}

handheldSlots.forEach((slot) => {
  slot.addEventListener('mouseenter', () => moveHandheldSelector(slot));
  slot.addEventListener('focus', () => moveHandheldSelector(slot));
  slot.addEventListener('click', (event) => {
    event.preventDefault();
    handleHandheldAction(slot.dataset.action, slot);
  });
});

function syncHandheldDockOpen() {
  if (!handheldDockEl) return;
  const logOpen = logPanelEl && !logPanelEl.hidden;
  const settingsNode = document.getElementById('settings-panel');
  const settingsOpen = settingsNode && !settingsNode.hidden;
  handheldDockEl.classList.toggle('is-open', Boolean(logOpen || settingsOpen));
}

if (handheldDockEl) {
  handheldDockEl.addEventListener('mouseleave', () => {
    syncHandheldDockOpen();
  });
}

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
    <p style="margin-top:12px;">
      <button type="button" id="open-progress-btn" class="toolbar-btn" style="display:inline-block;border:1px solid rgba(255,255,255,0.35);padding:6px 10px;">PROGRESS</button>
    </p>
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
    if (logPanelEl) logPanelEl.hidden = true;
    refreshAIStatus();
    refreshAudioLibrary();
  } else {
    settingsPanelEl.hidden = true;
  }
  if (typeof syncHandheldDockOpen === 'function') syncHandheldDockOpen();
}

document.getElementById('settings-panel-close').addEventListener('click', () => {
  settingsPanelEl.hidden = true;
  if (typeof syncHandheldDockOpen === 'function') syncHandheldDockOpen();
});

document.getElementById('ai-recheck-btn').addEventListener('click', refreshAIStatus);

const openProgressBtn = document.getElementById('open-progress-btn');
if (openProgressBtn) {
  openProgressBtn.addEventListener('click', () => {
    settingsPanelEl.hidden = true;
    toggleProgressPanel();
    if (typeof syncHandheldDockOpen === 'function') syncHandheldDockOpen();
  });
}

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
// Page load — load data, wait for Start Game (unlocks audio)
// ---------------------------------------------------------------------------

advanceMainlineBtnEl.addEventListener('click', () => {
  if (gameState.storyMode !== 'interactive' || gameState.isTyping || gameState.isWaitingForAI) return;
  endInteractiveAndAdvanceMainline();
});

toggleSuggestionsBtnEl.addEventListener('click', () => {
  if (gameState.storyMode !== 'interactive') return;
  if (gameState.isTyping || gameState.isWaitingForAI) return;
  const willShow = suggestionChipsEl.hidden || suggestionChipsEl.classList.contains('is-collapsed');
  setChoicesExpanded(willShow);
});

const startScreenEl = document.getElementById('start-screen');
const startGameBtnEl = document.getElementById('start-game-btn');
let gameReadyToStart = false;
let startBlockedMessage = null;

async function beginGameFromTitle() {
  if (!gameReadyToStart || !startGameBtnEl) return;
  if (startGameBtnEl.dataset.starting === '1') return;
  startGameBtnEl.dataset.starting = '1';
  startGameBtnEl.disabled = true;
  startGameBtnEl.textContent = 'Starting…';

  const firstScene = storyScenes[0];
  const firstBgm =
    firstScene?.bgm && typeof firstScene.bgm === 'object'
      ? firstScene.bgm
      : firstScene?.bgm
        ? { id: firstScene.bgm, label: null }
        : { id: 'campsite', label: 'BGM · Campfire Night' };

  // Hide title first so the player isn't stuck on Loading/Starting.
  if (startScreenEl) {
    startScreenEl.classList.add('is-hidden');
  }

  if (startBlockedMessage) {
    displayDialogue('System', startBlockedMessage);
    return;
  }

  setStoryMode('scripted');
  updateBackground(gameState.currentBackground);
  playScene(firstScene);

  // Start audio after the scene is up (blob fetch may take a moment on CF).
  if (window.VNAudio?.unlockAndPlayBgm && firstBgm?.id) {
    window.VNAudio.unlockAndPlayBgm(firstBgm.id, firstBgm.label).catch((err) => {
      console.warn('[Audio] start play failed', err);
    });
  }
}

if (startGameBtnEl) {
  startGameBtnEl.addEventListener('click', () => {
    beginGameFromTitle();
  });
  startGameBtnEl.disabled = true;
  startGameBtnEl.textContent = 'Loading…';
}

loadGameData()
  .then(() => {
    setStoryMode('scripted');
    updateBackground(gameState.currentBackground);
    fitDialogueText();
    window.addEventListener('resize', () => fitDialogueText());

    // Unlock Start as soon as story JSON is ready.
    gameReadyToStart = true;
    if (startGameBtnEl) {
      startGameBtnEl.disabled = false;
      startGameBtnEl.textContent = 'Start Game';
    }

    // AI status / BGM warm-up must not block the title button.
    verifyGameServer().then((serverCheck) => {
      if (!serverCheck.ok) {
        startBlockedMessage =
          serverCheck.reason === 'file-protocol'
            ? "Run npm start, then open http://localhost:8765 in your browser. Opening index.html directly won't work with AI."
            : formatAIError(new Error('Failed to fetch'));
      }
    });

    if (window.VNAudio?.preload) {
      const warmId = storyScenes[0]?.bgm?.id || 'campsite';
      window.VNAudio.preload([warmId]).catch((err) => {
        console.warn('[Audio] preload', err);
      });
    }
  })
  .catch((error) => {
    console.error(error);
    startBlockedMessage =
      "Couldn't load story data (needs a local server—don't use file://). Run npx serve and refresh.";
    gameReadyToStart = true;
    if (startGameBtnEl) {
      startGameBtnEl.disabled = false;
      startGameBtnEl.textContent = 'Start Game';
    }
  });
