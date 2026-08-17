import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const configUrl = pathToFileURL(resolve('playwright.config.js')).href;

async function loadPolicy(ciValue) {
  const original = process.env.CI;
  if (ciValue === undefined) delete process.env.CI;
  else process.env.CI = ciValue;

  try {
    const moduleUrl = `${configUrl}?config-contract=${encodeURIComponent(ciValue ?? 'unset')}`;
    const { default: config } = await import(moduleUrl);
    return {
      retries: config.retries,
      failOnFlakyTests: config.failOnFlakyTests,
    };
  } finally {
    if (original === undefined) delete process.env.CI;
    else process.env.CI = original;
  }
}

test('local Playwright runs are strict without diagnostic retries', async () => {
  assert.deepEqual(await loadPolicy(undefined), {
    retries: 0,
    failOnFlakyTests: false,
  });
  assert.deepEqual(await loadPolicy('false'), {
    retries: 0,
    failOnFlakyTests: false,
  });
});

test('CI keeps one diagnostic retry but rejects retry-dependent passes', async () => {
  assert.deepEqual(await loadPolicy('true'), {
    retries: 1,
    failOnFlakyTests: true,
  });
  assert.deepEqual(await loadPolicy('1'), {
    retries: 1,
    failOnFlakyTests: true,
  });
});
