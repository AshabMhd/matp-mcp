/**
 * Pluggable embedding engine.
 *
 * Default is a fully-free, offline, deterministic local embedder (n-gram hashing
 * trick + L2-normalized dense vector). It needs no network, no API key, and no
 * native modules, so it works anywhere Node runs.
 *
 * For materially better semantic similarity you can opt into a real embedding
 * model without changing the API surface:
 *   - Ollama (local + free):      EMBED_BACKEND=ollama   (defaults to http://localhost:11434, model nomic-embed-text)
 *   - OpenAI-compatible endpoint: EMBED_BACKEND=openai   (needs OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_EMBED_MODEL)
 */
export interface Embedder {
    readonly dim: number;
    embed(text: string): Promise<number[]>;
    label: string;
}
export declare function normalize(vec: number[]): number[];
/** Euclidean distance between two equal-length vectors. */
export declare function distance(a: number[], b: number[]): number;
/** Cosine similarity between two normalized vectors in [-1, 1]. */
export declare function cosineSimilarity(a: number[], b: number[]): number;
export declare function buildEmbedder(): Embedder;
