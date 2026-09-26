// Turn a sentence a supervisor types into a watch rule.
//   "When you see a ladder against the wall, say check your footing"
//   "Whenever there's a hose near the pad say move the hose"
//   "Now check for gloves and safety glasses"   -> rule with no fixed line (the model writes it)
//   "Look out for kids near the work area"

export function parseRuleText(input) {
  let t = String(input || '').trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  if (!t) throw new Error('type a rule, for example: When you see bare hands on the connector, say gloves on');

  const strip = (s) => s.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();

  const withSay = t.match(/^(?:when(?:ever)?|if)\s+(?:you\s+)?(?:see|notice|spot)?\s*(?:that\s+)?(.+?)(?:,\s*|\s+)(?:then\s+)?(?:say|tell (?:them|him|her|the tech)(?: to)?)\s*[:,]?\s*(.+)$/i);
  if (withSay) {
    return { when: strip(withSay[1]), say: capital(strip(withSay[2])) };
  }

  const watch = t.match(/^(?:now\s+)?(?:you(?:'re| are)\s+)?((?:check(?:ing)?|look(?:ing)?\s+out|watch(?:ing)?(?:\s+out)?|look(?:ing)?)\s+for\s+.+)$/i);
  if (watch) return { when: capital(strip(watch[1]).replace(/^checking/i, 'check').replace(/^looking/i, 'look').replace(/^watching/i, 'watch')), say: '' };

  const bare = t.match(/^(?:when(?:ever)?|if)\s+(?:you\s+)?(?:see|notice|spot)?\s*(.+)$/i);
  if (bare) return { when: strip(bare[1]), say: '' };

  return { when: t, say: '' };
}


function capital(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function ruleIdFrom(when) {
  const base = String(when)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 5)
    .join('-');
  return base || 'rule';
}
