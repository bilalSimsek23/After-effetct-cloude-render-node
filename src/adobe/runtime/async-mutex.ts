/**
 * Community Render Asset Protection & Project Lifecycle Security phase —
 * this node runs exactly one shared After Effects application instance for
 * its whole lifecycle (see AdobeRuntimeService's own docblock), but
 * config.maxConcurrentJobs is a genuinely supported value >1: PushServer
 * dispatches handleAssignedJob() without awaiting it, so two jobs' bodies
 * can already be running concurrently in this Node process.
 *
 * Before this class existed, nothing prevented two concurrently-running
 * jobs from both driving the SAME shared AE instance at once. That was
 * already unsafe on its own (AfterEffectsEngine.openProject() unconditionally
 * discards whatever project is currently open before opening the new one —
 * see that method's own comment), and adding an explicit project-close call
 * at the end of every job (this phase's core fix) makes the danger worse
 * without this guard: job A's own cleanup could close job B's
 * freshly-opened, still-rendering project out from under it.
 *
 * AsyncMutex.runExclusive() serializes ONLY the AE-touching portion of a
 * job's execution (see ExecutionPipeline.run()) — asset downloads and
 * Project Preparation (which happen entirely before a session/pipeline
 * run, per JobProcessor.processJob()) are untouched and still run in
 * parallel across concurrently-processed jobs. A FIFO queue, not a
 * starvation-prone one: each waiter is released in the exact order it
 * queued.
 */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previousTail = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previousTail;

    try {
      return await fn();
    } finally {
      release();
    }
  }
}
