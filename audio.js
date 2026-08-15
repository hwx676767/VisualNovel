/**
 * Audio manager — BGM/SFX matched by id like character expressions.
 * Place files under audio/bgm/{id}.mp3 and audio/sfx/{id}.mp3.
 * Missing files fall back to on-screen cue labels.
 */
window.VNAudio = (() => {
  let bgmEl = null;
  let currentBgm = null;
  let muted = false;
  let volume = 0.55;
  let cueTimer = null;
  let catalog = { bgm: [], sfx: [] };
  let inventory = { bgm: {}, sfx: {} };
  let catalogReady = null;

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
    return { muted, volume, currentBgm };
  }

  function showCue(label, { playing = false } = {}) {
    if (!label || typeof document === 'undefined') return;
    const gameContent = document.getElementById('game-content');
    if (!gameContent) return;
    const existing = document.getElementById('sound-cue');
    const cueEl = existing || document.createElement('div');
    cueEl.id = 'sound-cue';
    cueEl.textContent = playing ? `♪ Now playing · ${label}` : `♪ ${label}`;
    cueEl.classList.toggle('is-playing', playing);
    cueEl.classList.toggle('is-missing', !playing);
    if (!existing) gameContent.appendChild(cueEl);
    cueEl.hidden = false;
    clearTimeout(cueTimer);
    cueTimer = setTimeout(() => {
      cueEl.hidden = true;
    }, playing ? 2200 : 2600);
  }

  function buildPaths(kind, id) {
    return EXT_CANDIDATES.map((ext) => `audio/${kind}/${id}${ext}`);
  }

  function probeUrl(url) {
    return fetch(url, { method: 'HEAD' })
      .then((res) => {
        if (res.ok) return true;
        if (res.status !== 405 && res.status !== 501) return false;
        return fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1' } }).then((getRes) => getRes.ok);
      })
      .catch(() => false);
  }

  async function findExistingPath(kind, id) {
    const paths = buildPaths(kind, id);
    for (const path of paths) {
      if (await probeUrl(path)) return path;
    }
    return null;
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

  async function refreshInventory() {
    await loadCatalog();
    const next = { bgm: {}, sfx: {} };
    const jobs = [];
    for (const kind of ['bgm', 'sfx']) {
      for (const item of catalog[kind]) {
        jobs.push(
          findExistingPath(kind, item.id).then((path) => {
            next[kind][item.id] = {
              id: item.id,
              label: item.label,
              file: item.file,
              found: Boolean(path),
              path
            };
          })
        );
      }
    }
    await Promise.all(jobs);
    inventory = next;
    return inventory;
  }

  function getInventory() {
    return { catalog, inventory };
  }

  function tryPlayFile(paths, { loop = false } = {}) {
    return new Promise((resolve) => {
      let index = 0;
      function next() {
        if (index >= paths.length) {
          resolve(false);
          return;
        }
        const path = paths[index++];
        const audio = new Audio();
        audio.loop = loop;
        audio.volume = muted ? 0 : volume * (loop ? 1 : 0.9);
        audio.oncanplaythrough = () => {
          audio.play().catch(() => {});
          resolve({ audio, path });
        };
        audio.onerror = () => next();
        audio.src = path;
      }
      next();
    });
  }

  async function playBgm(id, label) {
    if (!id) return;
    if (currentBgm === id && bgmEl && !bgmEl.paused) return;

    const paths = buildPaths('bgm', id);
    const result = await tryPlayFile(paths, { loop: true });
    const display = label || id;
    if (!result) {
      showCue(label || `BGM · ${id}`, { playing: false });
      currentBgm = id;
      return;
    }

    if (bgmEl) {
      bgmEl.pause();
    }
    bgmEl = result.audio;
    bgmEl.loop = true;
    currentBgm = id;
    showCue(display.replace(/^BGM\s*·\s*/i, ''), { playing: true });
  }

  async function playSfx(id, label) {
    if (!id) return;
    const paths = buildPaths('sfx', id);
    const result = await tryPlayFile(paths, { loop: false });
    if (!result) {
      showCue(label || `SFX · ${id}`, { playing: false });
    }
  }

  /**
   * Apply scene audio fields: bgm, sfx, soundCue (legacy label-only).
   */
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

  return {
    playBgm,
    playSfx,
    applySceneAudio,
    showCue,
    setVolume,
    setMuted,
    getState,
    loadCatalog,
    refreshInventory,
    getInventory
  };
})();
