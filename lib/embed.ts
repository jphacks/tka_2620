// bge-m3 embeddings through Ollama: one 1,024-number vector per text, in input order.
// Error messages never include the texts (they can be note bodies).
export const EMBEDDING_DIMENSIONS = 1024;

// What a note is embedded as, wherever notes are written: its title and its body. A body often leaves its topic to
// the title (「保健所申請の締切が早くなった」 → 「2025年から締切が…」), so the body alone misses questions about it.
export function noteText(note: { title: string; body: string }): string {
  return `${note.title}\n${note.body}`;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const baseUrl = process.env.OLLAMA_BASE_URL;
  const model = process.env.EMBED_MODEL;
  if (!baseUrl || !model) {
    throw new Error("OLLAMA_BASE_URL and EMBED_MODEL must be set");
  }
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!response.ok) {
    throw new Error(`Ollama answered ${response.status} for ${model}`);
  }
  const { embeddings } = (await response.json()) as {
    embeddings?: number[][];
  };
  if (embeddings?.length !== texts.length) {
    throw new Error(
      `expected ${texts.length} embeddings, got ${embeddings?.length ?? 0}`,
    );
  }
  for (const vector of embeddings) {
    if (
      vector.length !== EMBEDDING_DIMENSIONS ||
      !vector.every(Number.isFinite)
    ) {
      throw new Error(
        `expected ${EMBEDDING_DIMENSIONS} numbers per embedding, got ${vector.length}`,
      );
    }
  }
  return embeddings;
}
