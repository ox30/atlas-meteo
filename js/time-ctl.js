import { emit } from './state.js';

class TimeController {
  constructor() {
    this.start = null; this.end = null; this.current = null;
    this.playing = false;
    this.speed = 300;
    this.lastTick = null;
    this.rafId = null;
  }
  init(start, end) {
    this.pause();
    this.start = start;
    this.end = end;
    this.current = new Date(start);
    emit('tick', { time: this.current, progress: 0 });
  }
  isInitialized() { return this.start !== null && this.end !== null; }
  setTime(t) {
    if (!this.isInitialized()) return;
    this.current = new Date(Math.max(this.start.getTime(), Math.min(this.end.getTime(), t)));
    emit('tick', { time: this.current, progress: this.getProgress() });
  }
  setProgress(p) {
    const span = this.end - this.start;
    this.setTime(this.start.getTime() + p * span);
  }
  getProgress() {
    if (!this.isInitialized()) return 0;
    const span = this.end - this.start;
    return span > 0 ? (this.current - this.start) / span : 0;
  }
  play() {
    if (!this.isInitialized()) return;
    if (this.current.getTime() >= this.end.getTime()) this.current = new Date(this.start);
    this.playing = true;
    this.lastTick = performance.now();
    emit('playStateChange', { playing: true });
    if (!this.rafId) this.tick();
  }
  pause() {
    this.playing = false;
    emit('playStateChange', { playing: false });
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  reset() { this.pause(); if (this.start) this.setTime(this.start.getTime()); }
  setSpeed(s) { this.speed = s; }
  tick() {
    if (!this.playing) { this.rafId = null; return; }
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    const newT = this.current.getTime() + dt * this.speed * 1000;
    if (newT >= this.end.getTime()) {
      this.setTime(this.end.getTime());
      this.pause();
      return;
    }
    this.setTime(newT);
    this.rafId = requestAnimationFrame(() => this.tick());
  }
}

export const TimeCtl = new TimeController();
