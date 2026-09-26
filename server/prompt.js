import { fillTemplate } from './playbooks.js';

export const SYSTEM_PROMPT = `You are the eyes of Base Academy. You see one still frame from a camera on a field technician's smart glasses (first-person view) while they install or service a Base Power home battery.

Your job for every frame:
1. Describe the scene in one short sentence.
2. Judge the CURRENT STEP against its check.
   - "pass": the check is clearly and fully met in this frame.
   - "fail": the thing being checked is clearly visible and clearly does NOT meet the check.
   - "unclear": the thing is not in frame, blurry, too far, too dark, or you cannot read it. When in doubt, use "unclear". Never guess a number you cannot read.
   Put what you actually see in "evidence" (for example "tape reads 28 inches at the window frame"). Give "confidence" from 0 to 1.
   If the status is fail or unclear, put one short spoken sentence in "coach_line" telling the tech what to do next (under 15 words, plain words, no jargon).
3. Check every WATCH RULE. List a rule in "rules" only if its condition is clearly visible in this frame. Use the rule's exact id. Add "evidence", and a short spoken "line" (under 15 words) the tech should hear.

Reply with JSON only.`;

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    scene: { type: 'STRING' },
    step: {
      type: 'OBJECT',
      properties: {
        status: { type: 'STRING', enum: ['pass', 'fail', 'unclear'] },
        evidence: { type: 'STRING' },
        confidence: { type: 'NUMBER' },
        coach_line: { type: 'STRING' },
      },
      required: ['status', 'evidence', 'confidence'],
    },
    rules: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, evidence: { type: 'STRING' }, line: { type: 'STRING' } },
        required: ['id', 'evidence'],
      },
    },
  },
  required: ['scene', 'step', 'rules'],
};

/** Build the per-frame user prompt from the live session (so rule edits apply on the next frame). */
export function buildUserPrompt(session) {
  const vars = { ...session.job, worker: session.worker };
  const i = session.current;
  const step = session.stepDefs[i];
  const st = session.steps[i];
  const rules = session.rules.filter((r) => !r.steps.length || r.steps.includes(st.id));

  const job = Object.entries(session.job)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const lines = [
    `JOB: ${session.playbookTitle}`,
    job ? `JOB FILE:\n${job}` : '',
    `CURRENT STEP (${i + 1} of ${session.steps.length}) id="${st.id}": ${step.title}`,
    `The tech was told: "${fillTemplate(step.say, vars)}"`,
    `CHECK: ${fillTemplate(step.check, vars)}`,
    rules.length
      ? `WATCH RULES:\n${rules.map((r) => `- id="${r.id}": ${fillTemplate(r.when, vars)}`).join('\n')}`
      : 'WATCH RULES: none',
    session.lastScene ? `Previous frame looked like: ${session.lastScene}` : '',
  ];
  return lines.filter(Boolean).join('\n\n');
}
