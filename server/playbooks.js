import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

const text = z.string().trim();
const optText = z.string().trim().default('');
const slug = z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/i, 'use letters, numbers and dashes only');

const StepSchema = z.object({
  id: slug,
  title: text.min(1),
  say: text.min(1),
  check: text.min(1),
  why: optText,
  pass_say: optText,
  fail_say: optText,
  hint: optText,
  min_confidence: z.number().min(0).max(1).default(0.6),
});

export const WatchRuleSchema = z.object({
  id: slug,
  when: text.min(1),
  say: optText,
  cooldown_s: z.number().min(0).default(30),
  steps: z.array(z.string()).default([]),
});

const PlaybookSchema = z.object({
  id: slug,
  title: text.min(1),
  summary: optText,
  frame_interval_ms: z.number().int().min(500).max(30000).default(2000),
  job: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  steps: z.array(StepSchema).min(1, 'a playbook needs at least one step in `steps`'),
  watch: z.array(WatchRuleSchema).default([]),
});

function describeZod(err) {
  return err.issues
    .map((i) => {
      const where = i.path.length ? i.path.join('.') : 'playbook';
      let msg = i.message;
      if (i.code === 'too_small' && i.origin === 'string') msg = "can't be empty";
      else if (i.code === 'invalid_type' && /received undefined/.test(i.message)) msg = 'is missing';
      else if (i.code === 'invalid_type') msg = `should be ${i.expected === 'array' ? 'a list' : i.expected === 'object' ? 'a section' : `a ${i.expected}`}`;
      return `${where}: ${msg}`;
    })
    .join('; ');
}

export function parsePlaybook(source) {
  let raw;
  try {
    raw = YAML.parse(source);
  } catch (e) {
    const line = e.linePos?.[0]?.line;
    throw new Error(`YAML error${line ? ` on line ${line}` : ''}: ${e.message.split('\n')[0]}`);
  }
  if (!raw || typeof raw !== 'object') throw new Error('playbook is empty');
  const res = PlaybookSchema.safeParse(raw);
  if (!res.success) throw new Error(describeZod(res.error));
  const pb = res.data;
  const seen = new Set();
  for (const s of pb.steps) {
    if (seen.has(s.id)) throw new Error(`duplicate step id "${s.id}"`);
    seen.add(s.id);
  }
  const seenRules = new Set();
  for (const r of pb.watch) {
    if (seenRules.has(r.id)) throw new Error(`duplicate watch rule id "${r.id}"`);
    seenRules.add(r.id);
  }
  return pb;
}

export function parseWatchRule(input) {
  const res = WatchRuleSchema.safeParse(input);
  if (!res.success) throw new Error(describeZod(res.error));
  return res.data;
}

/** Replace {key} with values from `vars`. Unknown keys stay visible so mistakes are easy to spot. */
export function fillTemplate(str, vars) {
  if (!str) return '';
  return String(str).replace(/\{([a-z0-9_]+)\}/gi, (m, k) =>
    vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m,
  );
}

export class PlaybookLibrary {
  constructor(dir) {
    this.dir = dir;
    this.byId = new Map();
    this.sources = new Map();
    this.loadErrors = [];
    this.listeners = new Set();
    this.watcher = null;
  }

  load() {
    const prevById = new Map(this.byId);
    const prevSources = new Map(this.sources);
    const prevFile = new Map(this.fileOf || []);
    this.byId = new Map();
    this.sources = new Map();
    this.fileOf = new Map();
    this.loadErrors = [];
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
      try {
        const src = fs.readFileSync(path.join(this.dir, f), 'utf8');
        const pb = parsePlaybook(src);
        this.byId.set(pb.id, pb);
        this.sources.set(pb.id, src);
        this.fileOf.set(pb.id, f);
      } catch (e) {
        if (e.code === 'ENOENT') continue; // renamed away mid-save by an editor
        this.loadErrors.push({ file: f, error: e.message });
        // A half-saved or broken file keeps the last good version live, so running crews aren't hurt.
        for (const [id, file] of prevFile) {
          if (file === f && !this.byId.has(id)) {
            this.byId.set(id, prevById.get(id));
            this.sources.set(id, prevSources.get(id));
            this.fileOf.set(id, f);
          }
        }
      }
    }
    return this;
  }

  list() {
    return [...this.byId.values()];
  }

  get(id) {
    return this.byId.get(id);
  }

  source(id) {
    return this.sources.get(id);
  }

  errors() {
    return this.loadErrors;
  }

  /** Validate then write. A bad playbook never reaches disk. */
  save(id, source) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw new Error('invalid playbook id');
    const pb = parsePlaybook(source);
    if (pb.id !== id) throw new Error(`the id inside the file ("${pb.id}") must match "${id}"`);
    const file = path.join(this.dir, `${id}.yaml`);
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, source);
    fs.renameSync(tmp, file);
    this.byId.set(id, pb);
    this.sources.set(id, source);
    (this.fileOf ||= new Map()).set(id, `${id}.yaml`);
    this.emit(id);
    return pb;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(id) {
    for (const fn of this.listeners) fn(id);
  }

  /** Pick up edits made in a text editor while the server runs. */
  watch() {
    if (this.watcher) return;
    let timer = null;
    try {
      this.watcher = fs.watch(this.dir, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          try {
            const before = new Map(this.sources);
            this.load();
            for (const [id, src] of this.sources) if (before.get(id) !== src) this.emit(id);
          } catch (e) {
            console.error(`playbook reload failed: ${e.message}`);
          }
        }, 150);
      });
    } catch {
      /* fs.watch is best-effort; the dashboard editor still works */
    }
  }

  close() {
    this.watcher?.close();
    this.watcher = null;
  }
}
