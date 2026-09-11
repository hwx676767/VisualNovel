/**
 * Audio manager — BGM/SFX matched by id like character expressions.
 * Place files under audio/bgm/{id}.mp3 and audio/sfx/{id}.{mp3,wav}.
 *
 * Why blob URLs: Cloudflare Pages often omits Accept-Ranges. HTML5 Audio
 * streaming breaks online while localhost (Express) works. Fetch→blob→play
 * avoids range requests.
 */
window.VNAudio = (() => {
  let bgmEl = null;
  let currentBgm = null;
  let currentBgmLabel = null;
  let muted = false;
  let volume = 0.55;
  let cueTimer = null;
  let catalog = { bgm: [], sfx: [] };
  let inventory = { bgm: {}, sfx: {} };
  let catalogReady = null;
  let unlocked = false;
  let unlockBound = false;
  let pendingBgm = null;
  const blobUrlCache = new Map();
  const objectUrls = new Set();

  const EXT_CANDIDATES = ['.mp3', '.ogg', '.wav'];

  function ensureBgmEl() {
    if (bgmEl) return bgmEl;
    bgmEl = new Audio();
    bgmEl.loop = true;
    bgmEl.preload = 'auto';
    bgmEl.volume = muted ? 0 : volume;
    return bgmEl;
  }

  function setVolume(value) {
    volume = Math.min(1, Math.max(0, Number(value) || 0));
    if (bgmEl && !muted) bgmEl.volume = volume;
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (bgmEl) bgmEl.volume = muted ? 0 : volume;
  }

  function getState() {
    return {
      muted,
      volume,
      currentBgm,
      unlocked,
      paused: !bgmEl || bgmEl.paused,
      src: bgmEl?.currentSrc || ''
    };
  }

  function showCue(label, { playing = false, hint = false } = {}) {
    if (!label || typeof document === 'undefined') return;
    const gameContent = document.getElementById('game-content');
    if (!gameContent) return;
    const existing = document.getElementById('sound-cue');
    const cueEl = existing || document.createElement('div');
    cueEl.id = 'sound-cue';
    cueEl.textContent = hint
      ? `♪ Tap anywhere to enable sound · ${label}`
      : playing
        ? `♪ Now playing · ${label}`
        : `♪ ${label}`;
    cueEl.classList.toggle('is-playing', playing && !hint);
    cueEl.classList.toggle('is-missing', !playing || hint);
    if (!existing) gameContent.appendChild(cueEl);
    cueEl.hidden = false;
    clearTimeout(cueTimer);
    cueTimer = setTimeout(() => {
      cueEl.hidden = true;
    }, hint ? 4500 : playing ? 2200 : 2600);
  }

  function buildPaths(kind, id) {
    return EXT_CANDIDATES.map((ext) => `audio/${kind}/${id}${ext}`);
  }

  async function resolveBlobUrl(path) {
    if (blobUrlCache.has(path)) return blobUrlCache.get(path);
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
    const blob = await response.blob();
    if (!blob || blob.size < 64) throw new Error(`Empty audio: ${path}`);
    const url = URL.createObjectURL(blob);
    blobUrlCache.set(path, url);
    objectUrls.add(url);
    return url;
  }

  async function resolvePlayableUrl(kind, id) {
    const paths = buildPaths(kind, id);
    let lastError = null;
    for (const path of paths) {
      try {
        const url = await resolveBlobUrl(path);
        return { path, url };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error(`No audio file for ${kind}/${id}`);
  }

  async function loadCatalog() {
    if (catalogReady) return catalogReady;
    catalogReady = fetch('audio/manifest.json')
      .then((res) => (res.ok ? res.json() : { bgm: [], sfx: [] }))
      .then((data) => {
        catalog = {
          bgm: Array.isArray(data.bgm) ? data.bgm : [],
          sfx: Array.isArray(data.sfx) ? data.sfx : []
        };
        return catalog;
      })
      .catch(() => {
        catalog = { bgm: [], sfx: [] };
        return catalog;
      });
    return catalogReady;
  }

  /**
   * Warm the first BGM (and optional ids) so Start Game can play without streaming.
   */
  async function preload(ids = ['campsite']) {
    await loadCatalog();
    const list = Array.isArray(ids) ? ids : [ids];
    await Promise.all(
      list.map(async (id) => {
        try {
          await resolvePlayableUrl('bgm', id);
        } catch (err) {
          console.warn('[Audio] preload failed', id, err);
        }
      })
    );
  }

  async function refreshInventory() {
    await loadCatalog();
    const next = { bgm: {}, sfx: {} };
    for (const kind of ['bgm', 'sfx']) {
      for (const item of catalog[kind] || []) {
        let found = false;
        let path = null;
        for (const candidate of buildPaths(kind, item.id)) {
          try {
            await resolveBlobUrl(candidate);
            found = true;
            path = candidate;
            break;
          } catch {
            /* try next ext */
          }
        }
        next[kind][item.id] = {
          id: item.id,
          label: item.label,
          file: item.file,
          found,
          path
        };
      }
    }
    inventory = next;
    return inventory;
  }

  function getInventory() {
    return { catalog, inventory };
  }

  async function resumePendingBgm() {
    if (!pendingBgm) return;
    const { id, label } = pendingBgm;
    pendingBgm = null;
    currentBgm = null;
    await playBgm(id, label);
  }

  function bindUnlockOnce() {
    if (unlockBound || typeof document === 'undefined') return;
    unlockBound = true;
    const unlock = async () => {
      unlocked = true;
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('touchstart', unlock);
      if (bgmEl && bgmEl.paused && currentBgm) {
        try {
          await bgmEl.play();
          showCue((currentBgmLabel || currentBgm).replace(/^BGM\s*·\s*/i, ''), {
            playing: true
          });
          pendingBgm = null;
          return;
        } catch {
          /* fall through */
        }
      }
      await resumePendingBgm();
    };
    document.addEventListener('pointerdown', unlock, { once: true, passive: true });
    document.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
  }

  /**
   * Call from Start Game click. Plays BGM from a preloaded blob when possible.
   */
  async function unlockAndPlayBgm(id, label) {
    unlocked = true;
    bindUnlockOnce();
    if (!id) return false;
    return playBgm(id, label);
  }

  async function playBgm(id, label) {
    if (!id) return false;
    if (currentBgm === id && bgmEl && !bgmEl.paused) return true;

    bindUnlockOnce();

    const display = label || id;
    currentBgmLabel = display;

    let resolved;
    try {
      resolved = await resolvePlayableUrl('bgm', id);
    } catch (err) {
      console.warn('[Audio] BGM missing', id, err);
      showCue(label || `BGM · ${id}`, { playing: false });
      currentBgm = id;
      return false;
    }

    if (bgmEl) {
      try {
        bgmEl.pause();
      } catch {
        /* ignore */
      }
    }

    const audio = new Audio();
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = muted ? 0 : volume;
    audio.src = resolved.url;
    bgmEl = audio;
    currentBgm = id;

    try {
      await audio.play();
      unlocked = true;
      pendingBgm = null;
      showCue(display.replace(/^BGM\s*·\s*/i, ''), { playing: true });
      return true;
    } catch (err) {
      console.warn('[Audio] BGM blocked/failed', id, err?.name || err);
      pendingBgm = { id, label: display };
      showCue(display.replace(/^BGM\s*·\s*/i, ''), { playing: false, hint: true });
      return false;
    }
  }

  async function playSfx(id, label) {
    if (!id) return;
    bindUnlockOnce();
    let resolved;
    try {
      resolved = await resolvePlayableUrl('sfx', id);
    } catch (err) {
      console.warn('[Audio] SFX missing', id, err);
      showCue(label || `SFX · ${id}`, { playing: false });
      return;
    }

    const audio = new Audio();
    audio.loop = false;
    audio.volume = muted ? 0 : volume * 0.9;
    audio.src = resolved.url;
    try {
      await audio.play();
      unlocked = true;
    } catch (err) {
      console.warn('[Audio] SFX blocked/failed', id, err?.name || err);
      showCue(label || `SFX · ${id}`, { playing: false, hint: true });
    }
  }

  function applySceneAudio(scene) {
    if (!scene) return;
    if (scene.bgm) {
      const label = typeof scene.bgm === 'object' ? scene.bgm.label : null;
      const id = typeof scene.bgm === 'object' ? scene.bgm.id : scene.bgm;
      playBgm(id, label);
    }
    if (scene.sfx) {
      const label = typeof scene.sfx === 'object' ? scene.sfx.label : null;
      const id = typeof scene.sfx === 'object' ? scene.sfx.id : scene.sfx;
      playSfx(id, label);
    }
    if (scene.soundCue && !scene.sfx && !scene.bgm) {
      showCue(scene.soundCue.label || scene.soundCue);
    }
  }

  loadCatalog();
  bindUnlockOnce();

  return {
    playBgm,
    playSfx,
    applySceneAudio,
    showCue,
    setVolume,
    setMuted,
    getState,
    unlockAndPlayBgm,
    unlockFromGesture: unlockAndPlayBgm.bind(null, null, null),
    preload,
    loadCatalog,
    refreshInventory,
    getInventory
  };
})();
