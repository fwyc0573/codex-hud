import { open } from 'fs/promises';

export interface JsonlTailBatch<T> {
  records: T[];
  nextOffset: number;
  truncated: boolean;
}

export async function readCompleteJsonl<T>(
  filePath: string,
  fromOffset: number
): Promise<JsonlTailBatch<T>> {
  if (!Number.isFinite(fromOffset) || !Number.isInteger(fromOffset) || fromOffset < 0) {
    throw new RangeError('JSONL offset must be a non-negative finite integer.');
  }

  const handle = await open(filePath, 'r');

  try {
    const { size: fileSize } = await handle.stat();
    const truncated = fileSize < fromOffset;
    const startOffset = truncated ? 0 : fromOffset;
    const bytes = Buffer.alloc(fileSize - startOffset);

    let totalBytesRead = 0;
    while (totalBytesRead < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        totalBytesRead,
        bytes.byteLength - totalBytesRead,
        startOffset + totalBytesRead
      );

      if (bytesRead === 0) {
        throw new Error(`Unexpected end of JSONL file at offset ${startOffset + totalBytesRead}.`);
      }

      totalBytesRead += bytesRead;
    }

    const finalNewlineIndex = bytes.lastIndexOf(0x0a);
    if (finalNewlineIndex === -1) {
      return {
        records: [],
        nextOffset: startOffset,
        truncated,
      };
    }

    const committed = bytes.subarray(0, finalNewlineIndex + 1);
    const records: T[] = [];

    for (const line of committed.toString('utf8').split('\n')) {
      if (line.trim().length === 0) {
        continue;
      }

      records.push(JSON.parse(line) as T);
    }

    return {
      records,
      nextOffset: startOffset + committed.byteLength,
      truncated,
    };
  } finally {
    await handle.close();
  }
}
