// Speaks coaching lines one at a time through whatever audio output the device uses
// (Meta glasses paired over Bluetooth = the glasses' speakers).
// Handles: iOS needing a user tap first, Chrome's stuck-queue bug, supervisor interrupts.

export class Speaker {
  constructor({ onStart, onEnd, rate = 1.05 } = {}) {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.queue = [];
    this.current = null;
    this.muted = false;
    this.rate = rate;
    this.onStart = onStart || (() => {});
    this.onEnd = onEnd || (() => {});
    this.voice = null;
    this.watchdog = null;
    this.seen = new Set();
    this.lastSpokeAt = 0;
    if (this.synth) {
      const pick = () => {
        const voices = this.synth.getVoices();
        this.voice =
          voices.find((v) => /en[-_]US/i.test(v.lang) && /natural|premium|enhanced|samantha|google us/i.test(v.name)) ||
          voices.find((v) => /en[-_]US/i.test(v.lang) && v.localService) ||
          voices.find((v) => /^en/i.test(v.lang)) ||
          null;
      };
      pick();
      this.synth.addEventListener?.('voiceschanged', pick);
    }
  }

  get supported() {
    return Boolean(this.synth);
  }

  /** Must run inside a tap handler once, or iOS/Safari stays silent. */
  unlock(text = 'Base Academy is ready.') {
    if (!this.synth) return;
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = this.rate;
    if (this.voice) u.voice = this.voice;
    this.synth.speak(u);
  }

  get speaking() {
    return Boolean(this.current) || Date.now() - this.lastSpokeAt < 700;
  }

  say(item) {
    if (!item?.text) return;
    if (item.id) {
      if (this.seen.has(item.id)) return; // duplicate after a reconnect
      this.seen.add(item.id);
      if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-200));
    }
    if (item.interrupt) {
      this.queue = [];
      this.stopCurrent();
    }
    this.queue.push(item);
    if (this.queue.length > 4) {
      // never fall more than a few lines behind: drop the oldest non-supervisor lines
      const keep = this.queue.filter((q) => q.source === 'supervisor');
      const rest = this.queue.filter((q) => q.source !== 'supervisor').slice(-3);
      this.queue = [...keep, ...rest].slice(-4);
    }
    this.pump();
  }

  stopCurrent() {
    clearTimeout(this.watchdog);
    this.current = null;
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
  }

  setMuted(m) {
    this.muted = m;
    if (m) {
      this.queue = [];
      this.stopCurrent();
    }
  }

  pump() {
    if (this.current || !this.queue.length) return;
    const item = this.queue.shift();
    this.onStart(item);
    if (this.muted || !this.synth) {
      this.onEnd(item);
      return this.pump();
    }
    const u = new SpeechSynthesisUtterance(item.text);
    u.rate = this.rate;
    if (this.voice) u.voice = this.voice;
    this.current = item;
    const done = () => {
      if (this.current !== item) return;
      clearTimeout(this.watchdog);
      this.current = null;
      this.lastSpokeAt = Date.now();
      this.onEnd(item);
      setTimeout(() => this.pump(), 120);
    };
    u.onend = done;
    u.onerror = done;
    // Chrome sometimes never fires onend; don't let one line block the rest.
    this.watchdog = setTimeout(() => {
      if (this.current === item) {
        try {
          this.synth.cancel();
        } catch {
          /* ignore */
        }
        done();
      }
    }, 2500 + item.text.length * 85);
    this.synth.speak(u);
  }
}
