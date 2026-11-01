# MATP MCP — Memory-Augmented Tool Policy Learning

An **MCP server** that turns historical `(Sub-goal, Tool, Parameters, Status)` execution
trajectories into a **ranked Tool Recommendation Matrix** plus **parameter auto-correction
hints**, injected into the agentic LLM prompt *before* it picks a tool. It fixes the classic
long-horizon-agent failure: repeated sub-optimal tool calls and invalid parameters caused by
relying on static system-prompt instructions alone.

It hooks where you described: the **Predictive Context Router** pre-fetches "Tool Execution
Recipes" (`matp_tool_policy_prompt`) instead of plain facts, and the **Background Synthesis
Engine** indexes full execution tuples (`matp_index_trajectory`) into the Semantic Memory
Buffer.

## What it does (the three MATP sub-tasks)

| Sub-task | MCP tool |
| --- | --- |
| **1. Execution Trajectory Indexing** — compress & vectorize the full `(Sub-goal, Tool, Params, Success)` tuple into the buffer | `matp_index_trajectory` |
| **2. Dynamic Tool Candidate Ranking** — rank tools by learned success rate under similar sub-goals + inject a compact recommendation matrix | `matp_recommend_tools`, `matp_tool_policy_prompt` |
| **3. Parameter Auto-Correction** — learn schema/formatting hints from past terminal/API error outputs and inject them before execution | `matp_learn_correction`, `matp_parameter_hints` |

Plus `matp_stats` for buffer telemetry.

## 2026 "best free" stack (why this is free, local, zero-config)

- **Model Context Protocol** via the official **TypeScript SDK v1** (`@modelcontextprotocol/sdk`, stable production line) over **stdio** — no API keys.
- **Vector store**: dependency-light, **zero-native-build** in-process brute-force cosine store persisted to a single JSON file (`data/matp.memory.json`). No server process, no compilation, works anywhere Node runs. Migration path to `sqlite-vec` behind the same `MemoryStore` interface when you outgrow ~millions of rows.
- **Embeddings**, pluggable via one env var:
  - `local` (default) — offline, deterministic n-gram hashing embedder. No network, no model download.
  - `ollama` — local **`nomic-embed-text`** (much better semantics, still free & private).
  - `openai` — `text-embedding-3-small` for when you already have a key.

## Install & run

```bash
cd matp-mcp
npm install
npm run build                 # -> dist/index.js
npm run smoke                 # optional: exercises the whole pipeline, no MCP host needed
node dist/index.js            # or: npx "matp-mcp"
```

### Free Testing & Host Alternatives (No Claude or Gemini required)

#### 1. Built-in Free MCP Test Client (Zero setup, 100% offline)
Runs a full automated client suite verifying all 11 MCP tools:
```bash
npm run test:client
# or full test suite:
npm run verify
```

#### 2. Official MCP Inspector (Free Visual Web UI Debugger)
Run from any terminal with network access to launch an interactive browser inspector:
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```
Opens an interactive web UI where you can inspect all schemas and execute tool calls in real time.

#### 3. VS Code with Cline / Roo Code / Continue (Free & Open Source)
You can use free IDE extensions like **Cline**, **Roo Code**, or **Continue** connected to a 100% free local model via **Ollama** (e.g. `llama3.2`, `qwen2.5-coder`, `mistral`).

In Cline/Roo Code MCP settings (`cline_mcp_settings.json`):
```json
{
  "mcpServers": {
    "matp": {
      "command": "node",
      "args": ["/Users/ashabmuhmmd/Desktop/nitk/project/llm/matp-mcp/dist/index.js"]
    }
  }
}
```

#### 4. Claude Desktop (Optional)
`~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "matp": {
      "command": "node",
      "args": ["/Users/ashabmuhmmd/Desktop/nitk/project/llm/matp-mcp/dist/index.js"]
    }
  }
}
```

### Optional env

| Var | Default | Meaning |
| --- | --- | --- |
| `EMBED_BACKEND` | `local` | `local` \| `ollama` \| `openai` |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama embed endpoint |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Ollama embed model |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_EMBED_MODEL` | — | OpenAI backend |
| `MATP_DATA_DIR` | `./data` | Where the memory buffer JSON lives |

## Tool lifecycle you'd wire into an agent loop

1. **Before the LLM picks a tool** (Predictive Context Router): call `matp_tool_policy_prompt { subGoal, candidateTools }` and inject the returned text into the prompt. It ranks tools by confidence-weighted success rate and appends parameter auto-correction hints (`--context length exceeded -> set max_tokens or stream pages`).
2. **After every tool call** (Background Synthesis Engine): call `matp_index_trajectory { subGoal, tool, parameters, status, outputSummary }` (pass errors as `outputSummary` on failure) so the lesson is learned for next time.
3. **When you catch a novel, recurring error**: call `matp_learn_correction { tool, errorPattern, hint }` to build a reusable correction rule.

## Example output

```
Memory-derived tool policy for sub-goal: "parse this big PDF and pull the tables out"
- pdf_reader: success ~60% (3 samples, confidence 54%)
- pdf_chunker: success ~33% (1 samples, confidence 47%)
- grep: success ~33% (1 samples, confidence 47%)
Parameter auto-correction hints:
  - on "context length exceeded" -> Set max_tokens explicitly or stream pages...
Rule: with equal intent, prefer the highest confidence-weighted success rate; if it failed with a
known parameter error, apply the correction hint before calling.
```

## Layout

```
matp-mcp/
  src/
    index.ts                 # MCP server entry (stdio)
    core/embed.ts            # pluggable embedding (local / ollama / openai)
    core/policy.ts           # ranking, recommendation matrix, auto-correction
    memory/memory.ts         # persistent vector Semantic Memory Buffer
    tools/indexTools.ts      # MCP tool registration (zod schemas)
```

## Notes & limits

- Similarity with the default `local` embedder is lexical hashing, not deep semantics — enable `ollama` for real semantic recall. The interface is identical either way.
- The vector store is single-process / single-file; process-local brute force is exact but linear. See the `MemoryStore` header for the `sqlite-vec` scale-out path.
- Success-rate smoothing (Laplacian + Bayesian weight) avoids over-trusting small sample counts.
- **MCP shutdown hygiene:** the SDK tears down the transport on exit; if you want graceful handling, signal handling is a thin addition in `index.ts`.