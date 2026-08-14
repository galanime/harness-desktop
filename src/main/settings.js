import fs from 'node:fs';
import { settingsFile, ensureDir } from './paths.js';
import path from 'node:path';

const DEFAULTS = {
  visionModel: 'qwen3-vl:4b',
  ollamaHost: 'http://127.0.0.1:11434',
  autoSync: true,
  autoUpdate: true,
  syncIntervalHours: 6,
};

let cache = null;

export function loadSettings() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  cache = next;
  ensureDir(path.dirname(settingsFile()));
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
