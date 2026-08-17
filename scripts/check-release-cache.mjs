import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const INDEX_FILE = resolve(ROOT, 'index.html');
const TOKEN_QUERY_RE = /([?&]v=)[^&'"\s)]+/g;
const VERSION_QUERY_RE = /^\?v=([^&]+)$/;

// These expressions intentionally cover only static ES-module declarations.
// Dynamic imports would need a runtime graph and therefore cannot be safely
// rewritten by this dependency-free release tool.
const SIDE_EFFECT_IMPORT_RE = /\bimport\s+(["'])([^"']+)\1/g;
const FROM_IMPORT_RE = /\b(?:import|export)\s+[^;\n]*?\s+from\s+(["'])([^"']+)\1/g;
const MODULE_SCRIPT_RE = /<script\b([^>]*\btype\s*=\s*["']module["'][^>]*)>/gi;
const SRC_ATTRIBUTE_RE = /\bsrc\s*=\s*(["'])([^"']+)\1/i;

function toPosix(value) {
  return value.split(sep).join('/');
}

function relativeName(file) {
  return toPosix(relative(ROOT, file));
}

function normalizeForHash(source) {
  return source
    .replace(/\r\n?/g, '\n')
    .replace(TOKEN_QUERY_RE, '$1<release-token>');
}

function queryToken(specifier) {
  const queryIndex = specifier.indexOf('?');
  if (queryIndex < 0) return null;
  const match = VERSION_QUERY_RE.exec(specifier.slice(queryIndex));
  return match?.[1] ?? null;
}

function withoutQuery(specifier) {
  return specifier.split('?')[0];
}

function resolveModuleRef(ownerFile, specifier) {
  const isIndexEntry = ownerFile === INDEX_FILE && specifier.startsWith('src/');
  if (!specifier.startsWith('.') && !isIndexEntry) {
    throw new Error(`${relativeName(ownerFile)} uses a non-relative browser module '${specifier}'`);
  }
  const pathPart = withoutQuery(specifier);
  if (!pathPart.endsWith('.js')) {
    throw new Error(`${relativeName(ownerFile)} uses a non-JavaScript module '${specifier}'`);
  }
  const target = resolve(ownerFile, '..', pathPart);
  const targetName = relativeName(target);
  if (targetName.startsWith('../') || targetName.includes('/../') || !targetName.startsWith('src/')) {
    throw new Error(`${relativeName(ownerFile)} points outside src/: '${specifier}'`);
  }
  return target;
}

function collectStaticRefs(source, ownerFile) {
  if (/\bimport\s*\(/.test(source)) {
    throw new Error(`${relativeName(ownerFile)} contains a dynamic import; release graph cannot rewrite it safely`);
  }

  const refs = [];
  const seen = new Set();
  const add = (match, specifier) => {
    const specifierStart = match.index + match[0].lastIndexOf(specifier);
    const key = `${specifierStart}:${specifier}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({
      ownerFile,
      specifier,
      start: specifierStart,
      end: specifierStart + specifier.length,
    });
  };

  for (const match of source.matchAll(SIDE_EFFECT_IMPORT_RE)) add(match, match[2]);
  for (const match of source.matchAll(FROM_IMPORT_RE)) add(match, match[2]);
  refs.sort((a, b) => a.start - b.start);
  return refs;
}

function entryRef(indexSource) {
  const matches = [...indexSource.matchAll(MODULE_SCRIPT_RE)];
  if (matches.length !== 1) {
    throw new Error(`expected exactly one module script in index.html, found ${matches.length}`);
  }
  const match = matches[0];
  const src = SRC_ATTRIBUTE_RE.exec(match[1]);
  if (!src) throw new Error('module script in index.html is missing src');
  const specifier = src[2];
  const srcStart = match.index + match[0].indexOf(src[2]);
  return {
    ownerFile: INDEX_FILE,
    specifier,
    start: srcStart,
    end: srcStart + specifier.length,
  };
}

async function readGraph() {
  const indexSource = await readFile(INDEX_FILE, 'utf8');
  const entry = entryRef(indexSource);
  const files = new Map([[INDEX_FILE, { file: INDEX_FILE, source: indexSource, refs: [entry] }]]);
  const queue = [entry];

  while (queue.length) {
    const ref = queue.shift();
    const target = resolveModuleRef(ref.ownerFile, ref.specifier);
    if (files.has(target)) continue;
    const source = await readFile(target, 'utf8');
    const refs = collectStaticRefs(source, target);
    files.set(target, { file: target, source, refs });
    queue.push(...refs);
  }

  return { files, refs: [...files.values()].flatMap((entry) => entry.refs) };
}

function expectedToken(files) {
  const hash = createHash('sha256');
  const entries = [...files.values()]
    .filter((entry) => entry.file !== INDEX_FILE)
    .sort((a, b) => relativeName(a.file).localeCompare(relativeName(b.file)));
  for (const entry of entries) {
    hash.update(relativeName(entry.file));
    hash.update('\0');
    hash.update(normalizeForHash(entry.source));
    hash.update('\0');
  }
  return `r${hash.digest('hex').slice(0, 12)}`;
}

function validateRef(ref, token) {
  const actual = queryToken(ref.specifier);
  if (!actual) {
    throw new Error(`${relativeName(ref.ownerFile)} has an unversioned module reference '${ref.specifier}'`);
  }
  if (actual !== token) {
    throw new Error(`${relativeName(ref.ownerFile)} uses ${actual}, expected ${token}`);
  }
}

function rewriteRefs(source, refs, token) {
  let result = source;
  for (const ref of [...refs].sort((a, b) => b.start - a.start)) {
    const queryIndex = ref.specifier.indexOf('?');
    if (queryIndex < 0 || !VERSION_QUERY_RE.test(ref.specifier.slice(queryIndex))) {
      throw new Error(`${relativeName(ref.ownerFile)} has an unsupported module query '${ref.specifier}'`);
    }
    const replacement = `${ref.specifier.slice(0, queryIndex)}?v=${token}`;
    result = `${result.slice(0, ref.start)}${replacement}${result.slice(ref.end)}`;
  }
  return result;
}

async function updateGraph(graph, token) {
  const changes = [];
  const pending = [];
  for (const entry of graph.files.values()) {
    const updated = rewriteRefs(entry.source, entry.refs, token);
    if (updated !== entry.source) {
      pending.push({ file: entry.file, updated });
      changes.push(relativeName(entry.file));
    }
  }
  for (const entry of pending) {
    await writeFile(entry.file, entry.updated, 'utf8');
  }
  return changes;
}

export async function checkReleaseCache({ update = false } = {}) {
  let graph = await readGraph();
  const token = expectedToken(graph.files);
  if (update) {
    const changes = await updateGraph(graph, token);
    if (changes.length) graph = await readGraph();
    for (const ref of graph.refs) validateRef(ref, token);
    return { token, files: graph.files.size - 1, refs: graph.refs.length, changes };
  }
  for (const ref of graph.refs) validateRef(ref, token);
  return { token, files: graph.files.size - 1, refs: graph.refs.length, changes: [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const update = process.argv.includes('--update');
  try {
    const result = await checkReleaseCache({ update });
    const action = update ? (result.changes.length ? `updated ${result.changes.join(', ')}` : 'already current') : 'verified';
    console.log(`release cache ${action}: ${result.token} (${result.files} modules, ${result.refs} references)`);
  } catch (error) {
    console.error(`release cache check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
