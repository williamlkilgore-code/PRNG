/* Sound effects and background music, generated with the Web Audio API.
 * No audio files: every effect is a small synth recipe, and the music is an
 * ambient drone with sparse plucked notes whose scale comes from the seed.
 * Browsers only allow audio after a user gesture, so nothing plays until
 * unlock() runs from the first tap or key press. Without Web Audio (or in
 * Node) every call is a no-op. */
(function (root) {
  const DC = root.DC;
  const AC = root.AudioContext || root.webkitAudioContext;
  const KEY = 'dicedelve-audio-v1';
  const DEFAULTS = { sfx: 0.7, music: 0.35, sfxOn: true, musicOn: true, muted: false };

  const settings = (() => {
    try { return Object.assign({}, DEFAULTS, JSON.parse(root.localStorage.getItem(KEY) || '{}')); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  })();
  const saveSettings = () => { try { root.localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ } };

  let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let unlocked = false, wanted = null, voice = null;
  const recent = [];      // last effect names played (handy for testing)
  const lastPlay = {};    // name -> [times], to stop pile-ups

  function ensure() {
    if (ctx || !AC) return !!ctx;
    ctx = new AC();
    master = ctx.createGain();
    // Gentle compression keeps stacked effects from clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyGains(true);
    return true;
  }

  function applyGains(now) {
    if (!ctx) return;
    const t = ctx.currentTime, k = now ? 0.001 : 0.08;
    master.gain.setTargetAtTime(settings.muted ? 0 : 1, t, k);
    sfxBus.gain.setTargetAtTime(settings.sfxOn ? settings.sfx : 0, t, k);
    musicBus.gain.setTargetAtTime(settings.musicOn ? settings.music : 0, t, k);
  }

  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (!unlocked) {
      // iOS needs a sound started inside the gesture.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
      unlocked = true;
      if (wanted) startVoice(wanted);
    }
  }

  // ------------------------------------------------------------- building blocks
  // A gain envelope: quick attack, exponential decay to silence.
  function env(t, vol, attack, dur, dest) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(dest || sfxBus);
    return g;
  }

  function tone(o) {
    const t = ctx.currentTime + (o.at || 0), dur = o.dur || 0.15;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    let node = env(t, o.vol || 0.2, o.attack || 0.005, dur, o.dest);
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.connect(node); node = f; }
    osc.connect(node);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  function noise(o) {
    const t = ctx.currentTime + (o.at || 0), dur = o.dur || 0.1;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    f.Q.value = o.q || 1;
    src.connect(f).connect(env(t, o.vol || 0.3, o.attack || 0.002, dur, o.dest));
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  const notes = (list, gap, o) => list.forEach((freq, i) => tone(Object.assign({ freq, at: i * gap }, o)));
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // ------------------------------------------------------------------- effects
  const SFX = {
    roll() { [0, 0.06, 0.14].forEach((at) => noise({ at, dur: 0.045, freq: 2600 + Math.random() * 1500, q: 2, vol: 0.45 }));
      tone({ type: 'triangle', freq: 320, dur: 0.05, vol: 0.08, at: 0.2 }); },
    step() { tone({ type: 'triangle', freq: 170 + Math.random() * 50, to: 120, dur: 0.06, vol: 0.12 }); },
    blocked() { tone({ freq: 120, to: 55, dur: 0.2, vol: 0.45 }); noise({ filter: 'lowpass', freq: 320, dur: 0.09, vol: 0.3 }); },
    web() { tone({ type: 'sawtooth', freq: 620, to: 180, dur: 0.38, vol: 0.12, lp: 1400 });
      tone({ type: 'square', freq: 470, to: 140, dur: 0.32, vol: 0.05, lp: 900, at: 0.03 }); },
    hit() { noise({ freq: 1100, q: 0.8, dur: 0.1, vol: 0.55 }); tone({ type: 'square', freq: 230, to: 110, dur: 0.12, vol: 0.14, lp: 1600 }); },
    kill() { SFX.hit(); notes([440, 220], 0.1, { type: 'square', dur: 0.14, vol: 0.12, lp: 2000, at: 0.06 }); },
    hurt() { tone({ type: 'sawtooth', freq: 150, to: 85, dur: 0.26, vol: 0.2, lp: 700 }); },
    coin() { tone({ type: 'triangle', freq: 988, dur: 0.08, vol: 0.22 }); tone({ type: 'triangle', freq: 1319, dur: 0.22, vol: 0.22, at: 0.07 }); },
    chest() { notes([523, 659, 784, 1047], 0.065, { type: 'triangle', dur: 0.22, vol: 0.18 }); },
    heal() { tone({ freq: 420, to: 900, dur: 0.42, vol: 0.18, attack: 0.04 }); tone({ type: 'triangle', freq: 630, to: 1260, dur: 0.38, vol: 0.08, at: 0.05, attack: 0.04 }); },
    key() { tone({ freq: 1568, dur: 0.55, vol: 0.16 }); tone({ freq: 2093, dur: 0.4, vol: 0.08, at: 0.01 }); tone({ freq: 3136, dur: 0.25, vol: 0.04 }); },
    door() { tone({ type: 'sawtooth', freq: 85, to: 170, dur: 0.45, vol: 0.14, lp: 600, attack: 0.05 }); noise({ freq: 400, q: 3, dur: 0.4, vol: 0.12, attack: 0.05 }); },
    pickOk() { [0, 0.1].forEach((at) => noise({ at, filter: 'highpass', freq: 3200, dur: 0.035, vol: 0.4 })); tone({ type: 'triangle', freq: 1175, dur: 0.18, vol: 0.12, at: 0.18 }); },
    pickFail() { noise({ filter: 'highpass', freq: 2200, dur: 0.06, vol: 0.6 }); tone({ type: 'square', freq: 320, to: 75, dur: 0.18, vol: 0.12, lp: 1500 }); },
    portal() { tone({ freq: 200, to: 1250, dur: 0.5, vol: 0.14, attack: 0.03 }); tone({ type: 'triangle', freq: 300, to: 1800, dur: 0.5, vol: 0.07, at: 0.04, attack: 0.03 }); },
    shoot() { noise({ freq: 700, to: 3200, q: 1.5, dur: 0.22, vol: 0.4, attack: 0.02 }); },
    miss() { noise({ filter: 'highpass', freq: 2600, dur: 0.05, vol: 0.35, at: 0.16 }); tone({ type: 'triangle', freq: 900, dur: 0.06, vol: 0.07, at: 0.16 }); },
    ammo() { [0, 0.07].forEach((at) => noise({ at, freq: 1800, q: 4, dur: 0.035, vol: 0.4 })); },
    pickup() { notes([660, 880], 0.07, { type: 'triangle', dur: 0.12, vol: 0.16 }); },
    torch() { for (let i = 0; i < 7; i++) noise({ at: Math.random() * 0.45, freq: 1200 + Math.random() * 1800, q: 6, dur: 0.03, vol: 0.3 });
      noise({ filter: 'lowpass', freq: 500, dur: 0.5, vol: 0.12, attack: 0.08 }); },
    stalker() { tone({ freq: 62, dur: 0.14, vol: 0.5 }); tone({ freq: 55, dur: 0.16, vol: 0.42, at: 0.17 }); },
    stairs() { notes([784, 659, 523, 392], 0.08, { type: 'triangle', dur: 0.2, vol: 0.16 }); },
    death() { tone({ type: 'sawtooth', freq: 320, to: 55, dur: 1.3, vol: 0.2, lp: 900, attack: 0.02 }); },
    buy() { noise({ filter: 'highpass', freq: 5000, dur: 0.05, vol: 0.25 }); notes([1319, 1760], 0.08, { dur: 0.25, vol: 0.14, at: 0.04 }); },
    gambleWin() { notes([523, 784, 1047, 1568], 0.07, { type: 'triangle', dur: 0.2, vol: 0.16 }); },
    gambleLose() { notes([392, 294], 0.14, { type: 'square', dur: 0.22, vol: 0.09, lp: 1200 }); },
    spell() { for (let i = 0; i < 6; i++) tone({ freq: 1500 + Math.random() * 1800, dur: 0.18, vol: 0.06, at: i * 0.05 }); },
    fireball() { noise({ filter: 'lowpass', freq: 400, to: 2400, dur: 0.55, vol: 0.5, attack: 0.03 }); tone({ type: 'sawtooth', freq: 90, to: 50, dur: 0.5, vol: 0.12, lp: 500 }); },
    ui() { tone({ freq: 820, dur: 0.035, vol: 0.08 }); },
  };

  function sfx(name) {
    recent.push(name);
    if (recent.length > 40) recent.shift();
    if (!unlocked || !ctx || !SFX[name] || settings.muted || !settings.sfxOn) return;
    // No more than 4 of the same sound in 100 ms (2 for footsteps).
    const now = ctx.currentTime, list = (lastPlay[name] || []).filter((t) => now - t < 0.1);
    if (list.length >= (name === 'step' ? 2 : 4)) return;
    list.push(now); lastPlay[name] = list;
    try { SFX[name](); } catch (e) { /* never let a sound break the game */ }
  }

  // --------------------------------------------------------------------- music
  const MODES = {
    aeolian: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
    minorPent: [0, 3, 5, 7, 10], majorPent: [0, 2, 4, 7, 9],
  };

  /* One mood's music: a filtered, detuned drone plus sparse plucks through a
   * feedback delay, scheduled slightly ahead of time. */
  function makeVoice(spec) {
    const rng = new DC.RNG(spec.seed >>> 0);
    const cfg = {
      floor: { root: 45 + rng.int(0, 7), mode: rng.pick(['aeolian', 'dorian', 'minorPent']), gap: [1.3, 2.8], cutoff: 520, drone: 0.11, pluck: 0.12 },
      dark: { root: 40 + rng.int(0, 4), mode: 'phrygian', gap: [2.6, 5.2], cutoff: 300, drone: 0.12, pluck: 0.1, wind: true },
      tutorial: { root: 48 + rng.int(0, 4), mode: 'majorPent', gap: [1.6, 3.0], cutoff: 650, drone: 0.08, pluck: 0.11 },
      shop: { root: 57, mode: 'majorPent', gap: [0.26, 0.52], cutoff: 1500, drone: 0.05, pluck: 0.11 },
    }[spec.mood];
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2);
    out.connect(musicBus);
    const nodes = [];

    // Drone.
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = cfg.cutoff; filt.Q.value = 2;
    const dg = ctx.createGain(); dg.gain.value = cfg.drone;
    filt.connect(dg).connect(out);
    const f0 = midi(cfg.root);
    [[f0, 'sawtooth', 0], [f0 * 1.006, 'sawtooth', 0], [f0 / 2, 'sine', 0]].forEach(([freq, type]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.connect(filt); o.start(); nodes.push(o);
    });
    const lfo = ctx.createOscillator(), lfoAmt = ctx.createGain();
    lfo.frequency.value = 0.05 + rng.next() * 0.06; lfoAmt.gain.value = cfg.cutoff * 0.45;
    lfo.connect(lfoAmt).connect(filt.frequency); lfo.start(); nodes.push(lfo);

    // Wind on dark floors: looping noise through a slowly wandering band-pass.
    if (cfg.wind) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.8;
      const wg = ctx.createGain(); wg.gain.value = 0.05;
      const wl = ctx.createOscillator(), wa = ctx.createGain(); wl.frequency.value = 0.07; wa.gain.value = 300;
      wl.connect(wa).connect(bp.frequency);
      src.connect(bp).connect(wg).connect(out);
      src.start(); wl.start(); nodes.push(src, wl);
    }

    // Plucks with a little echo.
    const delay = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain();
    delay.delayTime.value = spec.mood === 'shop' ? 0.24 : 0.42; fb.gain.value = 0.35; wet.gain.value = 0.5;
    delay.connect(fb).connect(delay); delay.connect(wet).connect(out);
    const scale = MODES[cfg.mode];
    let next = ctx.currentTime + 0.8, stepIdx = 0;
    const pluck = (t) => {
      // Shops walk up and down the scale like a jingle; elsewhere notes wander.
      const deg = spec.mood === 'shop' ? [0, 2, 4, 2, 1, 3, 4, 5][stepIdx++ % 8] : rng.int(0, scale.length * 2 - 1);
      const n = cfg.root + 12 + scale[deg % scale.length] + 12 * Math.floor(deg / scale.length);
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = midi(n);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(cfg.pluck, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (spec.mood === 'shop' ? 0.5 : 1.8));
      o.connect(g); g.connect(out); g.connect(delay);
      o.start(t); o.stop(t + 2);
    };
    const timer = setInterval(() => {
      while (next < ctx.currentTime + 0.25) {
        if (spec.mood !== 'shop' || rng.next() < 0.85) pluck(next);
        next += cfg.gap[0] + rng.next() * (cfg.gap[1] - cfg.gap[0]);
      }
    }, 30);

    return {
      key: spec.key,
      stop() {
        clearInterval(timer);
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
        out.gain.exponentialRampToValueAtTime(0.0001, t + 2);
        setTimeout(() => { nodes.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } }); out.disconnect(); }, 2300);
      },
    };
  }

  function startVoice(spec) {
    if (!ctx || !unlocked) return;
    if (voice && voice.key === spec.key) return;
    if (voice) { voice.stop(); voice = null; }
    if (spec.mood !== 'none') voice = makeVoice(spec);
  }

  // mood: 'floor' | 'dark' | 'shop' | 'tutorial' | 'none'
  function setMusic(mood, seed, floor) {
    const spec = { mood, key: `${mood}:${seed}:${floor}`, seed: DC.seedFor(seed, 'music', floor) };
    if (wanted && wanted.key === spec.key) return;
    wanted = spec;
    startVoice(spec);
  }

  // Pause everything while the tab is hidden.
  if (root.document) {
    root.document.addEventListener('visibilitychange', () => {
      if (!ctx || !unlocked) return;
      if (root.document.hidden) ctx.suspend(); else ctx.resume();
    });
  }

  DC.audio = {
    available: !!AC,
    settings,
    recent,
    get ctx() { return ctx; },
    get mood() { return wanted ? wanted.mood : 'none'; },
    unlock,
    sfx,
    setMusic,
    setVolume(bus, v) { settings[bus] = Math.max(0, Math.min(1, v)); applyGains(); saveSettings(); },
    setOn(bus, on) { settings[bus + 'On'] = !!on; applyGains(); saveSettings(); },
    toggleMute() { settings.muted = !settings.muted; applyGains(); saveSettings(); return settings.muted; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
