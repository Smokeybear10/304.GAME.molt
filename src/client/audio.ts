import type { GameEvent } from "../shared/types";
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private priorityCue = false;
  private noiseBuffer: AudioBuffer | null = null;
  private lastPlayerBasic = -Infinity;
  private lastEnemyAttack = -Infinity;
  private lastEnemyHit = -Infinity;
  private lastEnemyDeath = -Infinity;
  private lastSurface = -Infinity;
  private lastPlayerChargeSurface = -Infinity;
  private lastPatternTell = -Infinity;
  private lastImpact = { player: -Infinity, enemy: -Infinity, echo: -Infinity };
  muted = false;
  async unlock() {
    this.context ??= new AudioContext();
    if (!this.master) {
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.38;
      this.master.connect(this.context.destination);
      this.effects = this.context.createGain();
      this.effects.connect(this.master);
    }
    if (this.context.state === "suspended" || this.context.state === "interrupted")
      await this.context.resume();
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        muted ? 0 : 0.38,
        this.context.currentTime,
        0.03
      );
  }
  suspend() {
    this.master?.disconnect();
    this.master = null;
    this.effects = null;
    this.lastPlayerBasic = -Infinity;
    this.lastEnemyAttack = -Infinity;
    this.lastEnemyHit = -Infinity;
    this.lastEnemyDeath = -Infinity;
    this.lastSurface = -Infinity;
    this.lastPlayerChargeSurface = -Infinity;
    this.lastPatternTell = -Infinity;
    this.lastImpact = { player: -Infinity, enemy: -Infinity, echo: -Infinity };
    void this.context?.suspend();
  }
  private duckEffects(duration: number) {
    const ctx = this.context, gain = this.effects?.gain;
    if (!ctx || !gain) return;
    const now = ctx.currentTime;
    if (typeof gain.cancelAndHoldAtTime === "function") gain.cancelAndHoldAtTime(now);
    else {
      const held = gain.value;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(held, now);
    }
    gain.setTargetAtTime(0.28, now, 0.008);
    gain.setTargetAtTime(1, now + duration, 0.045);
  }
  private tone(
    start: number,
    end: number,
    duration: number,
    volume: number,
    type: OscillatorType = "sine",
    delay = 0
  ) {
    const ctx = this.context,
      output = this.priorityCue ? this.master : this.effects;
    if (!ctx || !output || this.muted || ctx.state !== "running") return;
    const at = ctx.currentTime + delay,
      osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(start, at);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, end),
      at + duration
    );
    gain.gain.setValueAtTime(0.001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    osc.connect(gain);
    gain.connect(output);
    osc.start(at);
    osc.stop(at + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  private noise(
    duration: number,
    volume: number,
    frequency: number,
    type: BiquadFilterType = "lowpass",
    delay = 0,
    attack = 0.003
  ) {
    const ctx = this.context,
      output = this.priorityCue ? this.master : this.effects;
    if (!ctx || !output || this.muted || ctx.state !== "running") return;
    if (!this.noiseBuffer) {
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + Math.random() * 0.12 - 0.06) * 0.98;
        data[i] = Math.max(-0.95, Math.min(0.95, last * 5));
      }
    }
    const at = ctx.currentTime + delay,
      source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(
      volume,
      at + Math.min(attack, duration / 2)
    );
    gain.gain.linearRampToValueAtTime(0, at + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    source.start(at, Math.random() * (1 - duration), duration);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }
  events(events: GameEvent[], playerId: number) {
    if (!this.context || this.context.state !== "running" || this.muted) return;
    const now = this.context.currentTime * 1000;
    const ownedSources = new Set([playerId]);
    for (const event of events)
      if (event.type === "possess") ownedSources.add(event.fromId);
    const impacts = events.filter(event => event.type === "impact");
    const impactSources = new Set(impacts.filter(event => event.kind !== "shock" && event.hitCount > 0).map(event => event.sourceId));
    const damagedEnemies = new Set(events.flatMap(event =>
      event.type === "damage" && event.faction === "enemy" ? [event.targetId] : []));
    const selectedImpacts = new Map<string, Extract<GameEvent, { type: "impact" }>>();
    for (const impact of impacts) {
      const selected = selectedImpacts.get(impact.faction);
      if (!selected || impact.hitCount > selected.hitCount)
        selectedImpacts.set(impact.faction, impact);
    }
    const ringTell = now - this.lastPatternTell >= 300
      ? events.find(event => event.type === "attack" && event.phase === "windup" && event.pattern?.kind === "ring")
      : undefined;
    const hurt = events.some(event => event.type === "damage" && event.faction === "player");
    const possessed = events.some(event => event.type === "possess");
    if (hurt || possessed || ringTell) this.duckEffects(ringTell ? 0.26 : 0.22);
    for (const event of events) {
      this.priorityCue = event === ringTell || event.type === "possess" ||
        (event.type === "damage" && event.faction === "player") || event.type === "result";
      if (event.type === "attack") {
        if (event.phase !== "release") {
          if (event === ringTell) {
            this.lastPatternTell = now;
            this.tone(410, 440, 0.09, 0.028, "sine");
            this.tone(550, 610, 0.12, 0.025, "sine", 0.12);
          }
          continue;
        }
        const owned = ownedSources.has(event.sourceId);
        const basic = event.kind === "basic";
        const echo = event.kind === "echo";
        if (owned && basic) {
          if (now - this.lastPlayerBasic < 45) continue;
          this.lastPlayerBasic = now;
        } else if (!owned && !echo) {
          if (now - this.lastEnemyAttack < 90) continue;
          this.lastEnemyAttack = now;
        }
        const volume = owned ? 1 : echo ? 0.7 : 0.4;
        if (event.pattern?.kind === "ring") {
          this.noise(0.11, 0.14 * volume, 1500, "bandpass");
          this.tone(240, 95, 0.13, 0.09 * volume, "triangle");
        } else if (event.species === "spitter") {
          this.noise(
            basic ? 0.045 : 0.085,
            (basic ? 0.09 : 0.15) * volume,
            700,
            "bandpass"
          );
          this.tone(
            basic ? 145 : 125,
            basic ? 120 : 95,
            basic ? 0.05 : 0.08,
            (basic ? 0.04 : 0.065) * volume
          );
          if (!basic) this.noise(0.025, 0.04 * volume, 1200, "lowpass", 0.055);
        } else if (event.species === "beetle") {
          this.tone(310, 285, 0.035, 0.075 * volume);
          this.noise(0.025, 0.1 * volume, 1800, "bandpass");
          this.noise(
            basic ? 0.045 : 0.1,
            0.09 * volume,
            1100,
            "highpass",
            0.025
          );
        } else {
          this.tone(205, 165, 0.045, 0.04 * volume, "triangle");
          this.noise(0.035, 0.09 * volume, 1400, "bandpass");
          this.noise(0.015, 0.035 * volume, 700, "lowpass", 0.025);
        }
      }
      if (event.type === "surface") {
        const playerCharge = event.faction === "player" && event.kind === "charge";
        const lastSurface = playerCharge ? this.lastPlayerChargeSurface : this.lastSurface;
        if (now - lastSurface < 70) continue;
        if (playerCharge) this.lastPlayerChargeSurface = now;
        else this.lastSurface = now;
        const volume =
          event.faction === "player"
            ? 1
            : event.faction === "echo"
            ? 0.65
            : 0.4;
        if (event.kind === "spit") {
          this.noise(
            0.045,
            0.055 * volume,
            event.material === "bread" ? 700 : 1000,
            "lowpass"
          );
          this.tone(125, 85, 0.045, 0.025 * volume);
        } else if (event.material === "bread") {
          this.noise(0.065, 0.1 * volume, 1700, "bandpass");
          this.noise(0.025, 0.035 * volume, 2700, "highpass", 0.025);
          this.tone(110, 80, 0.035, 0.025 * volume, "triangle");
        } else {
          this.noise(0.022, 0.085 * volume, 3300, "highpass");
          this.tone(1560, 1370, 0.028, 0.04 * volume);
          this.tone(920, 880, 0.022, 0.018 * volume, "sine", 0.004);
        }
      }
      if (event.type === "possess") {
        if (event.healed > 0) this.tone(320, 480, 0.14, 0.045, "triangle", 0.08);
        this.noise(0.075, 0.1, 1000, "lowpass", 0, 0.045);
        this.tone(140, 112, 0.05, 0.06, "sine", 0.065);
        this.noise(0.025, 0.08, 850, "bandpass", 0.085);
      }
      if (event.type === "damage" && event.faction === "enemy") {
        if (impactSources.has(event.sourceId)) continue;
        if (now - this.lastEnemyHit >= 45) {
          this.lastEnemyHit = now;
          const heavy = event.amount >= 3;
          this.tone(
            heavy ? 155 : 245,
            heavy ? 48 : 105,
            heavy ? 0.09 : 0.04,
            heavy ? 0.13 : 0.07,
            "triangle"
          );
          this.noise(
            heavy ? 0.07 : 0.035,
            heavy ? 0.18 : 0.1,
            heavy ? 1000 : 2200,
            "bandpass"
          );
        }
      }
      if (event.type === "damage" && event.faction === "player") {
        if (event.shellBroken) {
          this.noise(0.12, 0.34, 2400, "highpass");
          this.tone(350, 65, 0.13, 0.16, "triangle");
          this.tone(185, 45, 0.12, 0.11, "triangle", 0.06);
        }
        if (event.coreDamage > 0) {
          this.noise(0.17, 0.35, 1400);
          this.tone(75, 35, 0.2, 0.22, "triangle");
        } else if (!event.shellBroken) {
          this.noise(0.055, 0.3, 1800, "highpass");
          this.tone(410, 190, 0.045, 0.14, "triangle");
          this.tone(270, 130, 0.035, 0.07, "triangle", 0.045);
        }
      }
      if (event.type === "death" && !event.player) {
        if (damagedEnemies.has(event.id)) continue;
        if (now - this.lastEnemyDeath < 40) continue;
        this.lastEnemyDeath = now;
        this.tone(170, 40, 0.11, 0.1);
        this.noise(0.09, 0.14, 1100);
      }
      if (event.type === "impact") {
        if (selectedImpacts.get(event.faction) !== event) continue;
        const interval = event.faction === "player" ? 65 : 110;
        if (now - this.lastImpact[event.faction] < interval) continue;
        this.lastImpact[event.faction] = now;
        const volume = (event.faction === "player" ? 1 : event.faction === "echo" ? 0.7 : 0.3) *
          (event.hitCount > 0 ? 1 : 0.28);
        if (event.kind === "charge") {
          this.tone(175, 145, 0.05, 0.11 * volume, "triangle");
          this.noise(0.07, 0.15 * volume, 1500);
          this.tone(350, 320, 0.025, 0.035 * volume, "sine", 0.014);
        } else if (event.kind === "leap") {
          this.tone(95, 72, 0.065, 0.1 * volume, "triangle");
          this.noise(0.06, 0.14 * volume, 950);
          this.noise(0.018, 0.045 * volume, 1500, "bandpass", 0.018);
        } else if (event.kind === "dash") {
          this.tone(240, 480, 0.085, 0.06, "sine");
          this.noise(0.11, 0.14, 1800, "bandpass");
        } else if (event.kind === "graze") {
          this.tone(620, 980, 0.09, 0.09, "sine");
          this.tone(920, 1280, 0.11, 0.065, "triangle", 0.03);
        } else if (event.kind === "spore") {
          this.tone(130, 42, 0.22, 0.18, "triangle");
          this.noise(0.24, 0.22, 520, "lowpass");
          this.tone(320, 140, 0.12, 0.08, "sine", 0.02);
        } else {
          this.tone(75, 60, 0.1, 0.11 * volume, "triangle");
          this.noise(0.1, 0.13 * volume, 650);
        }
      }
      if (event.type === "encounterClear") {
        this.noise(0.24, 0.055, 650, "lowpass", 0, 0.055);
        this.tone(105, 92, 0.14, 0.025, "sine", 0.01);
      }
      if (event.type === "result" && event.result.outcome === "dead")
        this.tone(140, 35, 0.7, 0.18, "triangle");
      if (event.type === "result" && event.result.outcome === "escaped") {
        this.tone(130, 65, 0.045, 0.08);
        this.noise(0.04, 0.12, 1500, "bandpass");
        this.noise(0.4, 0.1, 900, "highpass");
      }
    }
  }
}
