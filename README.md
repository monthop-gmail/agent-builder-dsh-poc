# agent-builder-dsh-poc

> เขียน Agent เป็น Manifest หนึ่งไฟล์ แล้ว build ลง runtime ไหนก็ได้

**สถานะ: 🟢 PoC ใช้งานได้** — `npm test` ผ่าน 45 test, CLI รันได้จริง
ยังไม่ใช่ production: ไม่มี UI, ไม่มี database, sub-agent ยังไม่ทำ (P5)

```text
        Agent Manifest (.yaml)          ← WHAT · ไม่รู้จัก runtime ใด ๆ
                │
                ▼
        ┌───────────────┐
        │ Agent Builder │  load → validate → resolve → policy → compile → package
        └───────┬───────┘
                │  CompiledAgent  (runtime-neutral)
                ▼
         Runtime Adapter               ← --target openai-compatible | pi | acp | dsh | mock
                │
                ▼
      Runtime ปลายทาง
       model · tools · MCP · trace
```

---

## เป้าหมายเดียวของ PoC นี้

> **เปลี่ยน runtime target ได้โดยไม่แก้ Manifest แม้แต่บรรทัดเดียว**

`tests/portability.test.ts` พิสูจน์ข้อนี้: build manifest เดียวกันลงทุก target ที่ลงทะเบียนไว้
แล้ว assert ว่า checksum ของ manifest และ capability ที่ agent ได้รับ **เท่ากันหมด**

```bash
$ agent-builder build manifests/code-reviewer.yaml --target mock --out m.json
$ agent-builder build manifests/code-reviewer.yaml --target openai-compatible  --out d.json
$ diff <(jq 'del(.target,.builtAt)' m.json) <(jq 'del(.target,.builtAt)' d.json)
   # ไม่มี diff
```

---

## เริ่มใช้งาน

```bash
npm install --ignore-scripts
npm run build

# ไม่ต้องใช้ key เลย — mock เป็น runtime จริงที่ไม่ต่อเน็ต
node dist/cli/index.js targets
node dist/cli/index.js inspect manifests/code-reviewer.yaml --target openai-compatible
node dist/cli/index.js run manifests/code-reviewer.yaml --target mock --approve deny --trace

# รันจริงบน endpoint จริง
cp .env.example .env      # ใส่ LLM_GATEWAY_BASE_URL + LLM_GATEWAY_API_KEY
node --env-file=.env dist/cli/index.js models          # endpoint เสิร์ฟ model อะไรบ้าง
node --env-file=.env dist/cli/index.js run manifests/researcher.yaml \
  --target openai-compatible --input "อธิบาย MCP protocol สั้น ๆ"
```

### ใช้ opencode zen (หรือ OpenAI-compatible gateway ตัวอื่น)

`openai-compatible` คุยกับ chat completions ล้วน ๆ ดังนั้น gateway ตัวไหนก็ใช้ได้ทันที
โดยไม่ต้องแก้โค้ด — และเส้นทางนี้ก็เป็นเส้นทางที่ B1 อยากให้เดินอยู่แล้ว

```bash
LLM_GATEWAY_BASE_URL=https://opencode.ai/zen/v1
LLM_GATEWAY_API_KEY=sk-...
```

```bash
agent-builder models                                    # ถามว่าเสิร์ฟ model อะไร
agent-builder run manifests/researcher.yaml --target openai-compatible --input "..."
```

ถ้าอยากให้ manifest เรียกด้วยชื่อ `zen` ตรง ๆ (ไม่ผ่าน gateway) ตั้ง `OPENCODE_ZEN_API_KEY`
กับ `OPENCODE_ZEN_MODEL` แล้วเขียน `model.preferred: [zen]` — catalog ไม่ hardcode model id
ของ zen ไว้ เพราะรายการที่มันเสิร์ฟเปลี่ยนได้ ให้ถามจาก `agent-builder models` แทน

| คำสั่ง | ทำอะไร |
|---|---|
| `validate <manifest>` | ตรวจกับ contract + registry |
| `inspect <manifest> [--target]` | โชว์ว่า Builder resolve อะไรให้ และ policy หักอะไรออก |
| `build <manifest> --target <id>` | ออกเป็น `.agentpkg.json` |
| `run <manifest> --target <id>` | compile แล้วรัน (`--audit-log <f>` เก็บ trace · `--resume <id>` ต่อ session เดิม) |
| `targets` | รายชื่อ target + ตาราง autonomy level |
| `models [--provider <n>]` | catalog ในเครื่อง + ถาม endpoint จริงว่าเสิร์ฟ model อะไร |

---

## ทำไมโครงเป็นแบบนี้

### Manifest ไม่มี `spec.runtime`

runtime คือ **build target** ไม่ใช่คุณสมบัติของ agent — เหมือน `gcc --target` ที่ไม่ได้เขียนอยู่ในไฟล์ `.c`
ถ้า manifest ระบุ runtime ได้ ก็แปลว่ามันรู้จัก runtime และ portability ก็หายไปทันที
validator จะ reject `spec.runtime` พร้อมบอกให้ใช้ `--target` แทน

### Policy บังคับที่ Builder ไม่ใช่ที่ runtime

```
granted = allowed − forbidden          ← หักที่ Builder
```

tool ที่ถูก forbid **ไม่เคยเดินทางไปถึง runtime** ดังนั้น adapter ที่เขียนใหม่แล้วลืมเช็ค policy
ก็ยังปลอดภัย เพราะไม่มี tool ให้เรียกตั้งแต่แรก ถ้าให้ runtime เป็นคนบังคับ ทุก adapter ใหม่คือ
โอกาสใหม่ที่จะลืม

### Autonomy ผูกกับ `effect` ของ tool

ทุก tool ประกาศ `effect` ว่า `read` / `write` / `irreversible`
`spec.autonomy.level` บอกว่า effect ไหนที่ agent ทำเองได้ ที่เหลือกลายเป็น approval request

| level | ชื่อ | ทำเองได้ |
|---|---|---|
| 0 | observe | ไม่มี — ทุกอย่างต้องขออนุมัติ |
| 1 | read | `read` |
| 2 | propose | `read`, `write` |
| 3 | act | ทุกอย่างที่ไม่ติด forbidden/humanApproval |

### Adapter ไม่เคยเห็น Manifest

`AgentRuntime` รับ `CompiledAgent` เท่านั้น — ไม่มี `validate(manifest)` และไม่มี `compile(manifest)`
adapter ที่อ่าน manifest ได้ จะค่อย ๆ งอกพฤติกรรมเฉพาะ manifest แล้ว portability ตายเงียบ ๆ
ถ้า adapter ทำอะไรไม่ได้ ให้บอกผ่าน `unsupported(compiled)` แทน

### `acp` — ขับ agent ของคนอื่น และบอกตรง ๆ ว่าคุมอะไรไม่ได้

`--target acp` ไม่ได้รัน agent เอง แต่เป็น **client** ของ agent ที่พูด
[Agent Client Protocol](https://agentclientprotocol.com) — DeepSeek Harness เป็นตัวแรกที่ทดสอบ

```bash
ACP_AGENT_COMMAND=dsh ACP_AGENT_ARGS="--profile acp" \
  agent-builder run manifests/researcher.yaml --target acp

# ต่อ session เดิม โดย policy มาจาก manifest วันนี้ ไม่ใช่วันที่ session เริ่ม
agent-builder run manifests/researcher.yaml --target acp --resume <sessionId>
```

สิ่งที่ได้คือ **`resume()`** ซึ่ง runtime อื่นทำไม่ได้ — session อยู่ฝั่ง agent จึงข้าม process ได้

สิ่งที่เสียคือของที่ต้องประกาศ ไม่ใช่ของที่ควรเงียบ:

```
$ inspect manifests/code-reviewer.yaml --target acp
  ⚠ target 'acp' does not support: tools.local, policy.forbidden
```

- **`tools.local`** — ACP ส่งความสามารถผ่าน MCP server เท่านั้น ไม่มีช่องทางให้ client
  ยื่น tool ของตัวเองเข้าไป manifest ที่ grant `web_search` จะได้ agent ที่ไม่มี `web_search`
- **`policy.forbidden`** — `session/new` ยื่น MCP server ทั้งตัว ไม่ใช่ subset ที่เลือกไว้
  และ agent ยังมี built-in ของมันเองอยู่แล้ว วัดจริงกับ DSH: session ที่ mount MCP หนึ่งตัว
  มี tool 40 ตัว รวม shell และทุกตัวที่ manifest สั่งห้าม

adapter ที่เงียบเรื่องนี้จะทำให้ manifest **ดูเหมือนถูกบังคับใช้ทั้งที่ไม่ได้** ซึ่งแย่กว่าไม่รองรับเลย

และการประกาศก็มีผลจริง ไม่ใช่แค่ข้อความ:

```
$ run manifests/code-reviewer.yaml --target acp
  ⚠ acp: tools.local — granted tools ... cannot cross into this target
  ⛔ acp: policy.forbidden — the manifest forbids tools this target cannot withhold

refusing to run: target 'acp' cannot honour this manifest.        (exit 1)
```

**ช่องว่างที่ทำให้ข้อจำกัดหายไป → ปฏิเสธ · ช่องว่างที่ทำให้ความสามารถหายไป → เตือน**
กติกาและตารางระดับอยู่ใน [`docs/runtime-adapter.md`](docs/runtime-adapter.md)

### `dsh` — คุม tool ของ harness ด้วย patch ที่ compile จาก manifest

`--target dsh` คือ `acp` บวกขั้นตอนก่อน agent เกิด: compile `CompiledAgent` เป็น Cordis patch
แล้วให้ DSH boot ด้วย patch นั้น protocol ทั้งหมดใช้ของ `AcpRuntime` ไม่มีโค้ดซ้ำ

```bash
DSH_COMMAND=./node_modules/.bin/dsh \
  agent-builder run manifests/dsh-observer.yaml --target dsh
```

วัดจริงกับ harness ตัวจริง — session ธรรมดามี **40 tools รวม `bash`** ส่วน manifest ที่ autonomy 1
ได้ **18 ตัว ไม่มี `bash` ไม่มี `subagent`**

กลไกสองอย่าง ใช้ตรงที่วัดแล้วว่าได้ผล:

```
sandbox กัน file effect ได้ และ fail closed  →  file tool ยัง mount ให้ DSH_PERMISSION_MODE ตัดสิน
sandbox ไม่กัน exec/network                  →  shell ต้องกันด้วยการไม่ mount
```

| autonomy | sandbox | tool ที่ถูกกันออก |
|---|---|---|
| 0 observe | `read-only` | shell · delegation · **web** |
| 1 read | `read-only` | shell · delegation |
| 2 propose | `workspace-write` | shell · delegation |
| 3 act | `danger-full-access` | delegation |

**delegation ถูกกันทุกระดับ** — agent ที่ spawn agent อื่นได้ หลุดจาก tool set ที่ patch เพิ่งเลือกไป
และ sub-agent ยังเขียนใน manifest ไม่ได้ (P5)

`policy.forbidden` ยัง**บังคับไม่ได้** เหมือน `acp` — `dsh-mcp-client` bridge tool ทั้งเซ็ตของ MCP server
ไม่มี field ให้เลือกบางตัว `--target dsh` จึงยังปฏิเสธ manifest ที่มี `policy.forbidden`

### run ที่ล้มเหลว ห้ามโกหกว่าไม่มีอะไรเกิดขึ้น

free tier ตอบ 429/502/503 เป็นเรื่องปกติ — ทดสอบจริงกับ opencode zen เจอ 5 ครั้งใน 8 รอบ
ปัญหาไม่ใช่ความไม่เสถียร แต่คือ **รูปแบบความล้มเหลว**: รอบหนึ่ง agent โพสต์ข้อความลงโต๊ะประชุมสำเร็จ
แล้ว step ถัดไปตาย 502 ข้อความอยู่บนกระดานจริง แต่ CLI พิมพ์ว่า `run failed`

สามอย่างที่แก้:

```
429 / 5xx / เน็ตพัง   → backoff แล้วลองใหม่ (retry.ts)
ยังไม่ได้              → ไล่ไป model ถัดไปใน spec.model.preferred
ยังไม่ได้อีก            → RunAborted พา trace มาด้วย แล้ว CLI ลิสต์ tool ที่ทำงานไปแล้ว
```

`400`/`401` ไม่ retry — มันแปลว่า "ไม่ใช่แบบนี้" ไม่ใช่ "ไม่ใช่ตอนนี้" ลองซ้ำมีแต่เปลืองโควตา

### audit ต้องมีที่เก็บ ไม่ใช่แค่ field

`spec.audit.required: true` เคยแค่เปิด callback ในหน่วยความจำ ถ้าไม่ส่ง `--trace` ก็ไม่เหลืออะไร
ตอนนี้ `--audit-log <file>` เขียน JSON Lines: บรรทัดแรกบอกว่ารันอะไร (`runId`, `manifestChecksum`,
model, autonomy) แล้วตามด้วย event ละบรรทัด และถ้า manifest ขอ audit แต่ไม่มีที่เก็บ **CLI เตือน**
แทนที่จะเงียบ

### MCP tool คือ tool ธรรมดา

tool จาก MCP server ถูกแปลงเป็น `ResolvedTool` ตัวเดียวกับ tool ในเครื่อง
ทำให้ policy, approval และ trace ใช้เส้นทางเดียวกันหมด ไม่มี code path ที่สอง

จุดที่ยากคือ MCP server ไม่บอกว่ามี tool อะไรจนกว่าจะ connect — ซึ่งเกิด**หลัง** Builder ทำงานเสร็จ
ถ้าปล่อยให้ adapter เป็นคนหยิบ tool เหล่านั้นเอง policy จะคุมไม่ถึงและไม่มีใครรู้
ทางแก้: `runtimes/mcp-client.ts` เป็น**ที่เดียว**ที่ adapter ได้ MCP tool มา และมันเรียก
`admitLateTools()` ให้เสมอ — adapter ลืมไม่ได้ เพราะมันไม่ได้สร้าง MCP tool เอง

MCP ไม่มีสนามบอกว่า tool ไหนเปลี่ยนสถานะ ระบบจึงเดาให้: server descriptor ที่ระบุไว้ชนะก่อน
ตามด้วย heuristic จากชื่อ (`get_*`, `list_*`, `search_*` → `read`) แล้วค่อย default เป็น `write`
— เดาเป็น `read` ผิดแปลว่ายก tool ที่เขียนได้ให้ agent อ่านอย่างเดียว ซึ่งแก้ไม่ได้ย้อนหลัง

---

## โครงสร้าง

```text
manifests/               4 ตัว — researcher · code-reviewer · coding-agent · workspace-researcher
schema/                  JSON Schema (generate จาก zod ด้วย npm run schema)
builder/
  types.ts               CompiledAgent + AgentRuntime — ห้าม import runtime
  loader.ts              ไฟล์ → object + sha256 checksum
  validator.ts           contract agent/v1alpha2 (source of truth ของ schema)
  resolver.ts            ชื่อ → capability
  compiler.ts            Manifest → CompiledAgent
  packager.ts            CompiledAgent → .agentpkg.json
  tool-names.ts          ชื่อ tool → ชื่อบน wire (ใช้ร่วมกันทุก adapter)
  retry.ts               นโยบาย backoff — 429/5xx รอแล้วลองใหม่
  errors.ts              RunAborted — พา side effect ที่ลงไปแล้วติดมากับ error
  audit.ts               audit log แบบ JSON Lines
  registry/              tools · skills · mcp · models · policy · runtimes · capabilities
runtimes/
  openai-compatible/     loop ที่เขียนเอง บน endpoint แบบ OpenAI ตัวไหนก็ได้
  dsh/adapter.ts         DeepSeek Harness ตัวจริง — AcpRuntime + preset compiler
  dsh/preset.ts          CompiledAgent → Cordis patch
  pi/adapter.ts          Pi agent harness — Pi เป็นเจ้าของ loop
  acp/adapter.ts         ขับ agent ของคนอื่นผ่าน Agent Client Protocol
  acp/client.ts          JSON-RPC ndjson บน stdio ของ child process
  mock/adapter.ts        runtime จริงที่ไม่ต่อเน็ต ใช้ใน CI
  mcp-client.ts          MCP → ResolvedTool
cli/index.ts             validate · inspect · build · run · targets
tests/                   manifest · policy · portability · conformance · openai-compatible-runtime · pi-runtime · dsh-preset · acp-runtime · mcp-policy · resilience · capabilities
  support/acp-stub-agent.mjs  ACP agent จำลอง เก็บ session ลงไฟล์เพื่อทดสอบ resume ข้าม process
  support/openai-stub.ts endpoint ปลอมบน 127.0.0.1 ให้ conformance รันได้ทุก adapter
  fixtures/              manifest ที่มีไว้ทดสอบอย่างเดียว
```

---

## เขียน adapter ตัวใหม่

1. implement `AgentRuntime` (5 เมธอด) ใน `runtimes/<id>/adapter.ts`
2. ลงทะเบียนใน `builder/registry/runtimes.ts` — **ไฟล์เดียว** ไม่มีที่อื่นที่ต้องแก้
3. ให้ผ่าน `tests/conformance.test.ts` ซึ่งรันกับทุก runtime ที่ลงทะเบียนโดยอัตโนมัติ

รายละเอียดใน [`docs/runtime-adapter.md`](docs/runtime-adapter.md)

---

## Definition of Done

| # | ความสามารถ | สถานะ | พิสูจน์ด้วย |
|---|---|---|---|
| 1 | Agent Manifest | ✅ | `manifest.test.ts` — 3 ตัวอย่าง validate ผ่าน |
| 2 | Validation | ✅ | field แปลกปลอมและ `spec.runtime` ถูก reject |
| 3 | Capability Registry | ✅ | 7 registry: tool · skill · mcp · model · policy · runtime · capability-gap |
| 4 | Builder / Compiler | ✅ | `CompiledAgent` ไม่มี type ของ vendor |
| 5 | OpenAI-compatible Runtime | ✅ | `openai-compatible-runtime.test.ts` — agent loop จริงยิงใส่ stub บน localhost |
| 5b | **DSH Runtime ตัวจริง** | ✅ | `--target dsh` — patch ที่ generate ถูก harness ตัวจริงรับ tool ลดจาก 40 เหลือ 18 และ `bash` หายไป |
| 6 | MCP | ✅ | `mcp-policy.test.ts` — ยิงใส่ MCP server จริงบน localhost · policy คุม MCP tool ได้ |
| 7 | Sub-agent | ⏳ P5 | schema รับ `spec.subagents` แล้ว ยังไม่ compile |
| 8 | Issue → PR ⭐ | ⏳ P6 | `code-reviewer.yaml` + `github.*` tools พร้อมแล้ว |
| 9 | Resume | ✅ | `acp-runtime.test.ts` — resume ข้าม process · พิสูจน์กับ DSH ตัวจริงแล้ว |
| ★ | **สลับ runtime โดยไม่แก้ Manifest** | ✅ | `portability.test.ts` — build ทุก target แล้ว assert ว่าเท่ากัน |

---

## ที่เกี่ยวกับ ecosystem

- repo นี้อยู่ชั้น **L4 (Harness & Agent)** เสนอ Agent Manifest เป็น contract ให้ `agent-platform` (L3) รับไปเป็นเจ้าของ
- **B1 (gateway boundary)** — ตั้ง `LLM_GATEWAY_BASE_URL` แล้วทุก LLM call ออกทาง `llm-gateway`
  ถ้าไม่ตั้ง Builder จะ**เตือนว่ากำลังข้าม boundary** แล้วค่อยยิงตรง ไม่เงียบ
- **model list เป็นของ `free-llm-registry`** — ตั้ง `FREE_LLM_REGISTRY_URL` แล้ว catalog ในโค้ดจะถูกแทนที่
  seed ที่ฝังไว้เป็น fallback ตอน offline เท่านั้น
- ก่อนทำ **P6 (Issue → PR)** ต้องคุยกับ `ai-web-harness` (L4, เจ้าของ workflow
  requirement→design→implement→test→review→fix) และ `devfactory-core` (L7, orchestration) ก่อน

อ้างอิง: [ecosystem-brief](https://github.com/monthop-gmail/ecosystem-brief) ·
[agent-builder-pi-poc](https://github.com/monthop-gmail/agent-builder-pi-poc) (Pi runtime, จะรวมกันภายหลังเป็น `agent-builder-poc`)

---

## ขอบเขต PoC (ยังไม่ทำ)

UI · database · orchestration · sub-agent (P5) · `resume()` (interface มีแล้ว)
