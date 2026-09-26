// Stand-in for Gemini. Two uses:
//  - tests push scripted results/errors with enqueue()
//  - with no API key, "walkthrough" mode plays a believable job so the whole product can be demoed.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What the walkthrough "sees" for the bundled playbooks, so rehearsals read like a real job.
const WALK = {
  clearance: { scene: 'Tape measure from the battery to a window frame.', pass: 'Tape reads 38 inches at the window frame.', fail: 'Tape reads 24 inches at the window frame.' },
  level: { scene: 'Spirit level on top of the battery.', pass: 'Bubble is centered between the lines.' },
  connector: { scene: 'Close-up of the power connector.', pass: 'Plug fully in, latch closed, no band showing.' },
  labels: { scene: 'Front of the battery with two labels.', pass: 'BASE label and warning label are both readable.' },
  online: { scene: 'Phone showing the Base app.', pass: 'App shows the battery as Online.' },
  'read-fault': { scene: 'Phone showing the Base app.', pass: 'App shows fault E-214, connector temperature.', fail: 'App is on the home screen, no fault shown.' },
  'disconnect-off': { scene: 'Disconnect handle on the wall.', pass: 'Handle is in the OFF position.' },
  reseat: { scene: 'Close-up of the power connector.', pass: 'Connector seated, latch closed.' },
  'disconnect-on': { scene: 'Disconnect handle on the wall.', pass: 'Handle is in the ON position.' },
  'thumbs-up': { scene: 'A hand in front of the camera.', pass: 'Thumbs up.', fail: 'Open hand, not a thumbs up.' },
  'three-fingers': { scene: 'A hand in front of the camera.', pass: 'Three fingers up.' },
  screen: { scene: 'A laptop screen.', pass: 'Laptop screen in view.' },
};

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
    const seen = WALK[stepId] || { pass: 'Everything the check asks for is in the picture.', fail: 'Not quite there yet.' };
    // On step 3's first look, trip the first watch rule so rehearsals show the safety callout too.
    const firstRule = (input.user.match(/WATCH RULES:\n- id="([^"]+)"/) || [])[1];
    if (n === 1 && stepNo === 3 && firstRule) return { scene: 'Hands near the connector.', step: { id: stepId, status: 'unclear', evidence: 'Not in frame yet.', confidence: 0.4, coach_line: 'Bring it closer.' }, rules: [{ id: firstRule, evidence: 'Bare hand on the plug.', line: '' }] };
    if (n === 1) return { scene: 'Tech is lining up the next shot.', step: { id: stepId, status: 'unclear', evidence: 'Not in frame yet.', confidence: 0.4, coach_line: 'Bring it closer.' }, rules: [] };
    if (stepNo === 1 && n === 2) return { scene: seen.scene || 'Close view of the work area.', step: { id: stepId, status: 'fail', evidence: seen.fail, confidence: 0.86, coach_line: 'Fix that and show me again.' }, rules: [] };
    return { scene: seen.scene || 'Close view of the work area.', step: { id: stepId, status: 'pass', evidence: seen.pass, confidence: 0.9, coach_line: '' }, rules: [] };
  }

  describe() {
    return { provider: 'mock', model: this.walkthrough ? 'mock-walkthrough' : 'mock', keySet: false };
  }
}
