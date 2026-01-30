/**
 * Create a single-flight parse queue that never drops trailing updates.
 */
export function createParseQueue<T>(parseFn: () => Promise<T>): () => Promise<T> {
  let parseInFlight: Promise<T> | null = null;
  let parseQueued = false;

  const run = async (): Promise<T> => {
    if (parseInFlight) {
      parseQueued = true;
      return parseInFlight;
    }

    parseInFlight = (async () => {
      let result = await parseFn();
      while (parseQueued) {
        parseQueued = false;
        result = await parseFn();
      }
      return result;
    })();

    const result = await parseInFlight;
    parseInFlight = null;

    if (parseQueued) {
      parseQueued = false;
      return run();
    }

    return result;
  };

  return run;
}
