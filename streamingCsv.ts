/** Decode incrementally, retaining only the current CSV record, not every raw row. */
export async function* utf8Chunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* csvRecords(chunks: AsyncIterable<string>): AsyncGenerator<Record<string, string>> {
  let headers: string[] | null = null;
  let row: string[] = [], field = '', quoted = false, quotePending = false, skipLf = false;
  let recordSize = 0;
  const finish = () => {
    row.push(field); field = ''; recordSize = 0;
    const values = row; row = [];
    if (!values.some(value => value.trim())) return null;
    if (!headers) { headers = values.map(value => value.replace(/^\uFEFF/, '').trim()); return null; }
    return Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? '').trim()]));
  };
  for await (const chunk of chunks) {
    for (const char of chunk) {
      if (++recordSize > 2_000_000) throw new Error('CSV record exceeds size limit');
      if (skipLf) { skipLf = false; if (char === '\n') continue; }
      if (quoted) {
        if (quotePending) {
          quotePending = false;
          if (char === '"') { field += '"'; continue; }
          quoted = false;
        } else {
          if (char === '"') quotePending = true;
          else field += char;
          continue;
        }
      }
      if (char === '"') quoted = true;
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\n' || char === '\r') {
        skipLf = char === '\r';
        const record = finish();
        if (record) yield record;
      } else field += char;
    }
  }
  if (quoted && !quotePending) throw new Error('CSV ends inside a quoted field');
  if (field.length || row.length) { const record = finish(); if (record) yield record; }
}
