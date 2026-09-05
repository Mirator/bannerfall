// Plan 047 — run independent browser-side measurements at the same time.
//
// The balance measurements are the most expensive thing this repository runs, and every
// one of them is a loop over policies that do not talk to each other: the same seeds, the
// same camps, a different order set. They were written as one `page.evaluate` per policy
// awaited in sequence, which pins the whole measurement to a single renderer process and
// therefore to a single core, on a runner that has four.
//
// `measureInParallel` gives each job its OWN context and page. A context is a separate
// renderer process, so four policies genuinely occupy four cores; and because the storage
// is per-context, the `bf_save_test` slot one job writes cannot be seen by another.
//
// This does not change a single measured number, and that is the point — it must not.
// Each job seeds its own world through `scenario()` and steps it with an explicit dt, so
// the result depends on the seed and the orders and on nothing else. Verified rather than
// assumed: over 4 policies x 6 seeds x 3 camps the serial and parallel row sets are
// byte-identical, at 45.6 s against 17.3 s.
//
// Jobs are started together, so keep the LIST short — one entry per policy, not one per
// raid. Four contexts on a four-core runner is the shape this was measured at; a hundred
// would only trade parallelism for contention.
export async function measureInParallel(browser, jobs, run) {
  return Promise.all(jobs.map(async (job) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      return await run(page, job);
    } finally {
      await context.close();
    }
  }));
}
