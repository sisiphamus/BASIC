// Hands-free commands ("next", "repeat", "help", "back"). Chrome and Safari only.
// Ignores anything heard while the glasses are talking, so the app never answers itself.

import { matchCommand } from './commands.js';

export class VoiceCommands {
  constructor({ onCommand, onHeard, isSpeaking, onState }) {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    this.SR = SR || null;
    this.onCommand = onCommand;
    this.onHeard = onHeard || (() => {});
    this.isSpeaking = isSpeaking || (() => false);
    this.onState = onState || (() => {});
    this.rec = null;
    this.wanted = false;
    this.restartTimer = null;
  }

  get supported() {
    return Boolean(this.SR);
  }

  start() {
    if (!this.SR) return false;
    this.wanted = true;
    this.spawn();
    return true;
  }

  spawn() {
    if (!this.wanted) return;
    const rec = new this.SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const alts = [...e.results[i]].map((a) => a.transcript);
        this.onHeard(alts[0]);
        if (this.isSpeaking()) continue;
        const cmd = alts.map(matchCommand).find(Boolean);
        if (cmd) this.onCommand(cmd, alts[0]);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.wanted = false;
        this.onState('blocked');
      }
    };
    rec.onend = () => {
      // Browsers stop listening after silence; keep it alive.
      if (this.wanted) {
        clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => this.spawn(), 300);
      } else this.onState('off');
    };
    try {
      rec.start();
      this.rec = rec;
      this.onState('listening');
    } catch {
      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => this.spawn(), 1000);
    }
  }

  stop() {
    this.wanted = false;
    clearTimeout(this.restartTimer);
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
    this.onState('off');
  }
}
