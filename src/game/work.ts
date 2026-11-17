/**
 * A small scheduler for background work done in slices, so that preparing the next season's images while
 * the player plays never stalls a frame: a job is a generator that yields every few milliseconds of
 * work, and each frame `runWork` runs the most urgent jobs until its time budget is used.
 */

type Job = { key: string; priority: number; gen: Generator<void> }

const queue: Job[] = []
const queued = new Set<string>()

/**
 * Adds a job unless one with the same key is already waiting.
 *
 * @param key - Identifies the job (a second job with the same key is ignored).
 * @param priority - Lower runs first.
 * @param gen - The work, yielding between slices.
 * @returns True if it was added.
 */
export function enqueueJob(key: string, priority: number, gen: Generator<void>): boolean {
  if (queued.has(key)) {
    return false
  }
  queued.add(key)
  queue.push({ key, priority, gen })
  return true
}

/**
 * Whether a job with this key is waiting or running.
 *
 * @param key - The job's key.
 */
export function jobQueued(key: string): boolean {
  return queued.has(key)
}

/** Number of jobs waiting. */
export function pendingJobs(): number {
  return queue.length
}

/**
 * Runs queued jobs, most urgent first, for about `budgetMs` milliseconds (a slice may overrun a little).
 *
 * @param budgetMs - Time to spend.
 */
export function runWork(budgetMs: number): void {
  const start = performance.now()
  while (queue.length > 0 && performance.now() - start < budgetMs) {
    let best = 0
    for (let i = 1; i < queue.length; i += 1) {
      if ((queue[i]?.priority ?? 0) < (queue[best]?.priority ?? 0)) {
        best = i
      }
    }
    const job = queue[best]
    if (!job) {
      break
    }
    if (job.gen.next().done) {
      queue.splice(best, 1)
      queued.delete(job.key)
    }
  }
}
