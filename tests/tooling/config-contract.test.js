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

test('a spec file is never split across workers', async () => {
  // campaign-arc.spec.js memoizes one 48-campaign sweep at module scope and three @sweep
  // tests read it. That is only correct while Playwright hands a whole file to a single
  // worker, which is what `fullyParallel: false` buys. Raising the worker count does not
  // touch it; turning this flag on would run the sweep three times and nothing would fail
  // loudly enough to notice — the check would just get slower. Assert it explicitly.
  const { default: config } = await import(`${configUrl}?config-contract=parallelism`);
  assert.equal(config.fullyParallel, false);
});

test('the derived worker count is a positive integer inside the measured range', async () => {
  // plans/045 measured 1, 2, 3 and 4 workers on a 4-vCPU runner: 258 s, 179 s, 183 s, 178 s.
  // Two is the knee, and past it the per-test slowdown eats into the 30 s test timeout.
  // The config derives the number from the host's core count, so pin the shape rather than
  // the value, and pin the ceiling that keeps the timeout headroom. PW_WORKERS is unset for
  // the duration: it is a deliberate escape hatch for someone taking measurements on a
  // bigger machine, and it must not turn this contract red while they do.
  const override = process.env.PW_WORKERS;
  delete process.env.PW_WORKERS;
  try {
    const { default: config } = await import(`${configUrl}?config-contract=workers`);
    assert.equal(Number.isInteger(config.workers), true);
    assert.equal(config.workers >= 1, true);
    assert.equal(config.workers <= 2, true);
  } finally {
    if (override !== undefined) process.env.PW_WORKERS = override;
  }
});

test('CI records a trace for the retry rather than for every passing test', async () => {
  // `retain-on-failure` traced all 270 tests and deleted every trace, costing 16% of the
  // gate. Any change back to a mode that traces passing runs should be a decision, not a
  // drift, so name the two acceptable values here.
  const { default: config } = await import(`${configUrl}?config-contract=trace`);
  assert.equal(config.use.trace, 'on-first-retry');
  assert.equal(config.use.screenshot, 'only-on-failure');
});
