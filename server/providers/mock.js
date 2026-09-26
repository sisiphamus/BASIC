// Stand-in for Gemini. Two uses:
//  - tests push scripted results/errors with enqueue()
//  - with no API key, "walkthrough" mode plays a believable job so the whole product can be demoed.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class MockProvider {
  constructor({ delayMs = 150, walkthrough = true } = {}) {
    this.name = 'mock';
    this.delayMs = delayMs;
    this.walkthrough = walkthrough;
    this.queue = [];
    this.calls = [];
    this.counters = new Map();
  }

  /** item: a result object, an Error (thrown), or a function(input) returning either. */
  enqueue(...items) {
    this.queue.push(...items);
  }

  reset() {
    this.queue = [];
    this.calls = [];
    this.counters.clear();
  }

  async analyze(input) {
    this.calls.push({ user: input.user, system: input.system, bytes: input.image?.length ?? 0, sessionId: input.sessionId });
    const delay = input.mockDelayMs ?? this.delayMs;
    if (delay) await sleep(delay);
    let item = this.queue.shift();
    if (typeof item === 'function') item = await item(input);
    if (item instanceof Error) throw item;
    if (item) return { result: item, model: 'mock', latencyMs: delay };
    if (!this.walkthrough) return { result: { scene: 'nothing scripted', step: { status: 'unclear', evidence: '', confidence: 0, coach_line: '' }, rules: [] }, model: 'mock', latencyMs: delay };
    return { result: this.walk(input), model: 'mock-walkthrough', latencyMs: delay };
  }

  walk(input) {
    const stepId = (input.user.match(/CURRENT STEP \((\d+) of \d+\) id="([^"]+)"/) || [])[2] || 'step';
    const stepNo = Number((input.user.match(/CURRENT STEP \((\d+) of/) || [])[1] || 1);
    const key = `${input.sessionId}:${stepId}`;
    const n = (this.counters.get(key) || 0) + 1;
    this.counters.set(key, n);
    const check = (input.user.match(/CHECK: (.*)/) || [])[1] || '';
    if (n === 1) return { scene: 'Tech is lining up the next shot.', step: { id: stepId, status: 'unclear', evidence: 'not in frame yet', confidence: 0.4, coach_line: 'Bring it closer.' }, rules: [] };
    if (stepNo === 1 && n === 2) return { scene: 'Tape measure from battery to window frame.', step: { id: stepId, status: 'fail', evidence: 'tape reads 24 inches at the frame', confidence: 0.86, coach_line: 'Move the battery further from the window.' }, rules: [] };
    return { scene: 'Check looks complete.', step: { id: stepId, status: 'pass', evidence: `mock: ${check.slice(0, 80)}`, confidence: 0.9, coach_line: '' }, rules: [] };
  }

  describe() {
    return { provider: 'mock', model: this.walkthrough ? 'mock-walkthrough' : 'mock', keySet: false };
  }
}
