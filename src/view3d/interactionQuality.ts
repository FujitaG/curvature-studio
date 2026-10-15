/** Use sustained navigation frame delays, not one slow frame, to reduce screen cost. */
export class InteractionQuality {
  level = 0;
  preview = false;
  private previousTime: number | null = null;
  private quietSince: number | null = null;
  private slowFrames = 0;
  private settling = false;
  private intervals: number[] = [];
  private sampleIndex = 0;

  update(time: number, moving: boolean, held: boolean): void {
    this.settling = false;
    if (moving || held) {
      this.preview = true; this.quietSince = null;
      if (moving && this.previousTime !== null) {
        const elapsed = time - this.previousTime;
        if (elapsed > 0 && elapsed < 1000) {
          this.intervals[this.sampleIndex++ % 120] = elapsed;
          this.slowFrames = elapsed > 24 ? this.slowFrames + 1 : 0;
          if (this.slowFrames >= 4 && this.level < 2) {
            this.level++; this.slowFrames = 0;
          }
        } else this.slowFrames = 0;
      }
      if (!moving) this.slowFrames = 0;
      this.previousTime = moving ? time : null;
    } else {
      this.previousTime = null; this.slowFrames = 0;
      this.quietSince ??= time;
      this.settling = this.preview && time - this.quietSince < 120;
      if (!this.settling) { this.preview = false; this.level = 0; }
    }
  }
  pixelRatio(full: number): number { return Math.min(full, this.level === 2 ? 1.25 : this.level === 1 ? 1.5 : full); }
  get needsFrame(): boolean { return this.settling; }
  reset(): void { this.level = 0; this.preview = false; this.previousTime = null; this.quietSince = null; this.slowFrames = 0; this.settling = false; }
  frameIntervals(): number[] { return this.intervals.slice(); }
}
