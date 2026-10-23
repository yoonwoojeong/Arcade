import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST_FIELDS = [
  'id',
  'title',
  'version',
  'sdk',
  'author',
  'description',
  'controls',
  'accessibility',
  'sessionLength',
];

const ID_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SCREEN_READER = ['full', 'partial', 'none'];
const SESSION_LENGTH = ['short', 'medium', 'untimed'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkKeys(obj, allowed, where, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errors.push(`${where}unknown key "${k}"`);
  }
}

function checkString(obj, key, where, errors, { max } = {}) {
  const v = obj[key];
  if (typeof v !== 'string' || v.length < 1)
    errors.push(`${where}${key} must be a non-empty string`);
  else if (max !== undefined && v.length > max)
    errors.push(`${where}${key} must be at most ${max} characters`);
}

export function validateManifest(m, folderName) {
  if (!isObject(m)) return ['manifest must be an object'];
  const errors = [];
  checkKeys(m, MANIFEST_FIELDS, '', errors);
  for (const f of MANIFEST_FIELDS) {
    if (!(f in m)) errors.push(`missing required field "${f}"`);
  }

  if ('id' in m) {
    if (typeof m.id !== 'string' || !ID_RE.test(m.id)) errors.push(`id must match ${ID_RE}`);
    else if (m.id !== folderName)
      errors.push(`id "${m.id}" must equal folder name "${folderName}"`);
  }
  if ('title' in m) checkString(m, 'title', '', errors, { max: 40 });
  if ('version' in m && (typeof m.version !== 'string' || !SEMVER_RE.test(m.version))) {
    errors.push('version must be semver x.y.z');
  }
  if ('sdk' in m && m.sdk !== 1) errors.push('sdk must be 1');
  if ('author' in m) checkString(m, 'author', '', errors);
  if ('description' in m) checkString(m, 'description', '', errors, { max: 140 });

  if ('controls' in m) {
    const c = m.controls;
    if (!isObject(c)) errors.push('controls must be an object');
    else {
      checkKeys(c, ['keyboard', 'touch'], 'controls: ', errors);
      if (
        !Array.isArray(c.keyboard) ||
        c.keyboard.length < 1 ||
        c.keyboard.some((s) => typeof s !== 'string')
      ) {
        errors.push('controls.keyboard must be a non-empty array of strings');
      }
      if ('touch' in c && typeof c.touch !== 'string')
        errors.push('controls.touch must be a string');
    }
  }

  if ('accessibility' in m) {
    const a = m.accessibility;
    if (!isObject(a)) errors.push('accessibility must be an object');
    else {
      checkKeys(
        a,
        ['screenReader', 'reducedMotion', 'colorIndependent'],
        'accessibility: ',
        errors,
      );
      if (!SCREEN_READER.includes(a.screenReader)) {
        errors.push(`accessibility.screenReader must be one of ${SCREEN_READER.join('|')}`);
      }
      for (const k of ['reducedMotion', 'colorIndependent']) {
        if (typeof a[k] !== 'boolean') errors.push(`accessibility.${k} must be a boolean`);
      }
    }
  }

  if ('sessionLength' in m && !SESSION_LENGTH.includes(m.sessionLength)) {
    errors.push(`sessionLength must be one of ${SESSION_LENGTH.join('|')}`);
  }
  return errors;
}

export function loadRegistry(gamesDir) {
  const games = [];
  const warnings = [];
  let entries;
  try {
    entries = fs.readdirSync(gamesDir, { withFileTypes: true });
  } catch {
    return { games, warnings };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = entry.name;
    const manifestPath = path.join(gamesDir, folder, 'game.json');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(path.join(gamesDir, folder, 'index.js')))
      continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      warnings.push(`${folder}: ${e.message}`);
      continue;
    }
    const errors = validateManifest(manifest, folder);
    if (errors.length) warnings.push(`${folder}: ${errors.join('; ')}`);
    else games.push(manifest);
  }
  games.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return { games, warnings };
}
