/**
 * Runs `task` and rejects if anything throws outside its promise chain while
 * it is pending, such as a library throwing inside a stream `data` callback.
 * Without this such an error would crash the process before the caller's
 * `try/catch` sees it. The listener exists only while the task runs.
 */
export async function captureUncaughtErrors<T>(
  task: () => Promise<T>,
): Promise<T> {
  let listener: ((error: Error) => void) | undefined
  const uncaught = new Promise<never>((_resolve, reject) => {
    listener = reject
    process.on('uncaughtException', reject)
  })
  try {
    return await Promise.race([task(), uncaught])
  } finally {
    if (listener) process.off('uncaughtException', listener)
  }
}
