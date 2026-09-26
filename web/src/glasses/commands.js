// Map what the recognizer heard to a crew command. Short, forgiving phrases only,
// so normal talk on site ("next to the window") doesn't trigger anything.

const PHRASES = [
  // No bare "done", "skip", "again" or "why": people say those on site all the time.
  ['next', /^(?:ok(?:ay)? )?(?:next|next step|skip (?:this )?step|move on)$/],
  ['repeat', /^(?:repeat|repeat that|say (?:that|it) again|what(?:'s| is| was) (?:the|this) step)$/],
  ['help', /^(?:help|help me|what(?:'s| is) this for|how do i do (?:this|that)|i'm stuck|im stuck)$/],
  ['back', /^(?:back|go back|previous|previous step|last step)$/],
];

export function matchCommand(heard) {
  const t = String(heard || '')
    .toLowerCase()
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:hey |ok )?(?:base|academy|basic)\s*/, '')
    .replace(/ please$/, '');
  for (const [cmd, re] of PHRASES) if (re.test(t)) return cmd;
  return null;
}
