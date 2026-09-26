// Map what the recognizer heard to a crew command. Short, forgiving phrases only,
// so normal talk on site ("next to the window") doesn't trigger anything.

const PHRASES = [
  ['next', /^(?:ok(?:ay)? )?(?:next|next step|skip|skip it|skip this|done|move on)$/],
  ['repeat', /^(?:repeat|say (?:that|it) again|again|what(?:'s| is| was) (?:the|this) step|come again|pardon)$/],
  ['help', /^(?:help|help me|why|what(?:'s| is) this for|how do i do (?:this|that)|i'm stuck|im stuck)$/],
  ['back', /^(?:back|go back|previous|previous step|last step)$/],
];

export function matchCommand(heard) {
  const t = String(heard || '')
    .toLowerCase()
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:hey |ok )?(?:base|academy|base academy)\s*/, '')
    .replace(/ please$/, '');
  for (const [cmd, re] of PHRASES) if (re.test(t)) return cmd;
  return null;
}
