/**
 * MATP policy engine.
 *
 * Turns raw, similarity-nearest execution trajectories into actionable,
 * in-prompt guidance for the agentic LLM *before* it emits a tool call:
 *
 *   1. Dynamic Tool Candidate Ranking  -> rank tools by learned success rate
 *      under similar sub-goals.
 *   2. Tool Recommendation Matrix     -> compact, prompt-injectable summary
 *      ("Tool_A succeeded 90%; Tool_B failed with context overflow").
 *   3. Parameter Auto-Correction      -> schema/formatting hints derived from
 *      past terminal/API error outputs stored in the buffer.
 */
import { MemoryStore } from '../memory/memory.js';
export interface ToolCandidate {
    /** The tool the model is considering calling. */
    tool: string;
    /** Candidate limit on how many samples to consider when scoring. */
    k?: number;
}
export interface RecommendationMatrixEntry {
    tool: string;
    successRate: number | null;
    attempts: number;
    success: number;
    failure: number;
    partial: number;
    bestColor: string;
    exampleParameters: Record<string, unknown> | null;
    recentFailureReason: string | null;
}
export interface RankedTool {
    tool: string;
    successRate: number | null;
    attempts: number;
    confidence: number;
}
export interface RecommendationOutput {
    matrix: RecommendationMatrixEntry[];
    ranked: RankedTool[];
    autoCorrectionHints: CorrectionHint[];
    generatedAt: number;
    subGoal: string;
}
export interface CorrectionHint {
    ruleId: string;
    tool: string;
    errorPattern: string;
    hint: string;
    similarity: number;
}
export declare class MatpPolicy {
    private readonly store;
    constructor(store: MemoryStore);
    /** Aggregates nearest-neighbour trajectories into the recommendation matrix. */
    recommend(subGoal: string, candidates: ToolCandidate[] | undefined, opts?: {
        topK?: number;
        minSamples?: number;
    }): Promise<RecommendationOutput>;
    /** Fetches parameter-formatting hints for a specific tool from the error-correction buffer. */
    autoCorrect(subGoal: string, tools: string[]): Promise<CorrectionHint[]>;
    /** Renders the matrix as compact, prompt-ready text (what you inject into the system prompt). */
    renderPrompt(s: RecommendationOutput): string;
}
