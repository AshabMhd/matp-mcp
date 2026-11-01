/**
 * Registers all MATP MCP tools on the server.
 *
 * Tools:
 *   matp_index_trajectory    — index an execution tuple into the memory buffer
 *   matp_recommend_tools     — ranked Tool Recommendation Matrix (full JSON)
 *   matp_tool_policy_prompt  — prompt-injectable policy text (inject into system prompt)
 *   matp_parameter_hints     — recall parameter auto-correction hints for a tool
 *   matp_learn_correction    — index a reusable parameter correction rule
 *   matp_list_trajectories   — browse stored trajectories (with filters)
 *   matp_delete_trajectory   — remove a trajectory by id
 *   matp_purge_old           — delete trajectories older than N days
 *   matp_list_corrections    — browse learned correction rules
 *   matp_disable_correction  — soft-delete a correction rule by id
 *   matp_stats               — buffer telemetry
 */
import { MatpPolicy } from '../core/policy.js';
import type { MemoryStore } from '../memory/memory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerAll(server: McpServer, store: MemoryStore, policy: MatpPolicy): void;
