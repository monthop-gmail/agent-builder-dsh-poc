# agent-builder — ผลตรวจสอบ 2 PoC และข้อเสนอทิศทาง

วันที่ 2026-09-02 · ผู้บันทึก: Claude Code (ทดสอบจริง ไม่ใช่อ่านอย่างเดียว)
ขอบเขต: `agent-builder-dsh-poc`, `agent-builder-pi-poc`, `ecosystem-brief`
อ้างอิงเพิ่ม: `deepseek-ai/deepseek-harness`, `earendil-works/pi`, `cloudflare/cloudflare-os`

---

## 1. สรุปสำหรับคนที่มีเวลา 1 นาที

- ทั้งสอง PoC **ใช้งานได้จริง** ยืนยันด้วยการรันกับ opencode zen + MCP server ตัวจริงบน Cloudflare Workers
- **dsh-poc คือฐานที่ควรใช้ตอนรวม repo** — มี policy / portability / conformance ครบ
- แต่ชื่อ `dsh` **ไม่ตรงกับความจริง**: มันไม่ได้ต่อกับ DeepSeek Harness เลย สิ่งที่มีคือ adapter แบบ OpenAI-compatible
- ปัญหาที่บล็อก "ครบ loop" มี 3 ข้อ ทั้งหมดเจอจากการรันจริง ไม่ใช่การอ่านโค้ด
- ก่อนเพิ่ม runtime ตัวที่ 3 ต้องปิดช่อง semantic skew ก่อน ไม่งั้นเมทริกซ์จะบานจนคุมไม่ได้

---

## 2. สิ่งที่พิสูจน์แล้วว่าใช้ได้

### dsh-poc

| ทดสอบ | ผล |
|---|---|
| `npm run build` + `vitest` | ✅ 45 passed / 5 skipped ตรงตามที่ README เคลม |
| `models` ถาม zen จริง | ✅ 7 model (6 free + big-pickle) |
| ต่อ MCP worker จริง | ✅ initialize + tools/list ผ่าน bearer → 15 tools |
| รันครบวง zen + MCP | ✅ 6 tool call / 4 step สรุปสถานะโต๊ะประชุมเป็นภาษาไทยได้ |
| B1 gateway routing | ✅ `zen → mimo-v2.5-free [gateway] https://opencode.ai/zen/v1` |
| Portability (DoD ดาว) | ✅ build mock vs dsh → **byte-identical** หลังตัด `target` / `builtAt` |
| Policy หักที่ Builder | ✅ 15 tools บน server → **14 admitted, `resolve_decision` ถูกหักทิ้ง** |
| Approval gate บน MCP write | ✅ `↪ auto-denied collaboration.post_message (write) — autonomy.level` |
| เขียนลงโต๊ะประชุมจริง | ✅ ยืนยันฝั่ง server: `seq 12 · msg-3cbf4dc0` (total 11 → 12) |

ข้อที่สำคัญที่สุดคือ **policy คุม MCP tool ได้จริงกับ server ตัวจริง** — README เคลมไว้ และเป็นจริง

### pi-poc

| ทดสอบ | ผล |
|---|---|
| build + test | ✅ 13 passed |
| `--runtime mock` กับ manifest ที่ `runtime.type: pi` | ✅ สลับได้จริงตาม DoD |
| รันจบกับ zen + MCP `collab` | ✅ เรียก `get_workspace_context` / `get_decisions` / `get_plans` / `get_tasks` แล้วสรุปได้ |

หมายเหตุ: pi-ai มี provider `opencode` ชี้ไป `opencode.ai/zen` มาให้ในตัว ใช้ `OPENCODE_API_KEY`
manifest ที่เพิ่มไว้ตอนทดสอบ: `manifest/examples/zen-collab.yaml`

---

## 3. ปัญหาที่ต้องแก้ก่อน — ทั้งหมดมาจากการรันจริง

### 3.1 ไม่มี retry/fallback และมันสร้าง failure shape ที่แย่ที่สุด  — ✅ แก้แล้ว (ข้อ 11)

รอบที่โพสต์ลงโต๊ะประชุมสำเร็จ **จบด้วย `run failed`**

```
· tool_result  collaboration.post_message  chars:164   ← side effect ลงไปแล้ว
· model_call   step 2
run failed: 502 Upstream error from Nvidia
```

ข้อความถูกโพสต์จริง แต่ CLI คืน "failed" คนอ่านผลจะเข้าใจว่าไม่ได้โพสต์
`grep -rn "retry\|backoff"` ทั้ง repo เจอแค่ string ที่บอกโมเดลว่า "do not retry" ไม่มี retry logic จริง
เจอ 429 / 502 / 503 / 400 รวม 5 ครั้งใน 8 รอบ

**ต้องมี:** backoff บน 429/5xx · `model.preferred` เป็น fallback chain จริง (ตอนนี้ `resolveModel` หยิบตัวแรกที่เจอแล้วจบ ไม่เคยลองตัวที่สอง) · ถ้าจบไม่ได้ ต้องรายงาน side effect ที่ลงไปแล้ว

### 3.2 `audit: required: true` เป็นชื่ออย่างเดียว  — ✅ แก้แล้ว (ข้อ 11)

```ts
// runtimes/dsh/adapter.ts:112
if (compiled.audit) ctx.onTrace(event)
```

แค่เปิด callback ในหน่วยความจำ ไม่มีที่เก็บ ถ้าไม่ส่ง `--trace` ก็ไม่เหลืออะไร
ตอนนี้หลัง agent โพสต์ลงโต๊ะประชุมของทีมไปแล้ว **ไม่มีบันทึกที่ไหนเลยว่ามันทำ**
manifest สัญญาแล้วระบบไม่เก็บ อันตรายกว่าไม่มี field

**ต้องมี:** trace เขียนลงไฟล์/stream พร้อม `manifestChecksum` + `runId` + agent identity ต่อ 1 run

### 3.3 agent ไม่มีตัวตน

ข้อความที่โพสต์ขึ้นชื่อ **"Claude Code"** เพราะ MCP server ผูกชื่อกับ bearer token
ทุก agent ที่ใช้ token เดียวกันจะขึ้นชื่อเดียวกันหมด แยกไม่ออกว่าใครทำ ทั้งที่ `metadata.name` มีอยู่แล้ว

### 3.4 บั๊กใน pi-adapter ที่ต้องแก้ก่อนย้าย

```ts
const model = await resolveModel(config.model).catch(() => undefined)
```

ถ้า model ไม่อยู่ใน catalog ของ pi-ai มัน **เงียบ ๆ แล้วใช้ default model ของ Pi แทน**
manifest บอก model A ได้ model B โดยไม่มีใครรู้ — ต้อง throw ผ่าน `unsupported()`

และ pi-adapter ยัด MCP tool ทั้งหมดเข้าโมเดลตรง ๆ ไม่ผ่าน policy
**เป็นบั๊กตัวเดียวกับที่ dsh เจอและแก้ไปแล้ว** (บันทึกใน `docs/poc-results.md`)
ตอนย้ายต้องบังคับให้ไปหยิบ MCP tool ผ่าน `runtimes/mcp-client.ts` ที่เดียว

---

## 4. ข้อเท็จจริงที่ต้องแก้ความเข้าใจ

### 4.1 `agent-builder-dsh-poc` ไม่ได้ต่อกับ DeepSeek Harness

DeepSeek Harness เป็นของจริง — open-source agent harness ของ DeepSeek AI บน Cordis
สถาปัตยกรรม everything-is-a-plugin มี Web UI รันด้วย `npx @deepseek-ai/dsh web`

แต่:

```bash
$ cat agent-builder-dsh-poc/package.json | jq .dependencies
{ "@modelcontextprotocol/sdk", "yaml", "zod", "zod-to-json-schema" }   # ไม่มี @deepseek-ai/dsh
$ grep -rn "deepseek-harness\|@deepseek-ai\|cordis" runtimes/ builder/ cli/
(ไม่พบ)
```

`runtimes/dsh/adapter.ts` เขียน tool loop เอง 234 บรรทัด ยิง `fetch` ใส่ `/chat/completions`
สิ่งที่มันเป็นจริงคือ adapter ชื่อ **`openai-compatible`** ซึ่งเป็นงานที่ดีและใช้ได้จริง แต่ไม่ใช่ DSH

→ DoD ข้อ 5 `DSH Runtime ✅` ยังไม่จริง `dsh-runtime.test.ts` พิสูจน์ว่า loop ที่เราเขียนถูก ไม่ได้พิสูจน์ว่าต่อกับ DSH ได้

### 4.2 ใครใช้ agent loop ของใคร

| โปรเจกต์ | agent loop | หมายเหตุ |
|---|---|---|
| **cloudflare-os** | **Pi** (`pi-agent-core` → `runAgentLoopContinue`) | กวาดทั้ง repo แล้วไม่มี SDK ค่ายอื่นเลย ให้เครดิต Pi ไว้ใน README |
| **DeepSeek Harness** | **เขียนเอง** (`@deepseek-ai/dsh-agent-loop` — _"the harness's only concrete loop"_) | สลับได้ผ่าน interface `Agent` + `ctx.agents` |
| DSH ใช้ `pi-ai` | แค่ชั้น **LLM API** (`llm/llm-pi-ai`) ไม่มี `pi-agent-core` | ไม่ใช่ loop |

**DSH ฝัง loop ของ 4 ค่ายไว้เป็น subagent backend:**

| backend | ค่าย |
|---|---|
| `subagent-claude-code` | Anthropic — `@anthropic-ai/claude-agent-sdk`, รัน Claude Code CLI จริงเป็น child |
| `subagent-codex` | OpenAI — `@openai/codex` ผ่าน `app-server --stdio` |
| `subagent-acp` | ใครก็ได้ที่พูด ACP |
| `subagent-dsh-sdk` | DSH เอง ผ่าน JSON-RPC |

---

## 5. บทเรียนเชิงสถาปัตยกรรม (ส่วนที่กระทบแผน)

### 5.1 "runtime" ซ่อนสัญญาการเชื่อม 3 แบบ

```
Library      เราเรียกเขา        Pi, Claude Agent SDK, OpenAI Agents SDK
Host/plugin  เขาเรียกเรา        DSH + Cordis
Protocol     คุยผ่านสาย         ACP
```

`AgentRuntime` ปัจจุบัน (`createAgent` → `run` → `dispose`) เข้ากับแบบ Library เท่านั้น

### 5.2 semantic skew มีอยู่แล้ววันนี้ ตอนมี runtime แค่ 2 ตัว

```ts
// dsh  run(agent, input, ctx: RunContext)   ← มี requestApproval + onTrace
// pi   run(agent, input)                    ← ไม่มี
```

pi ไม่มี `RunContext` และ README ของ Pi ก็เขียนเองว่า
_"Pi does not include a built-in permission system"_ แล้วแนะนำ containerization แทน

> ⚠️ **แก้ข้อสรุปเดิม (ดูข้อ 10)** — ตอนแรกผมสรุปจากตรงนี้ว่า Pi บังคับ `humanApproval` ไม่ได้
> **ผิด** Pi ไม่มี permission system ก็จริง แต่ adapter เป็นคนเขียน `execute` ของทุก tool เอง
> จึงดักขออนุมัติก่อน side effect ได้ ตอนรวม repo ทำแล้วและมีเทสต์ยืนยัน
> สิ่งที่ pi-poc ขาดคือ adapter ไม่ได้ทำ ไม่ใช่ Pi ทำไม่ได้

→ ถึงอย่างนั้น ข้อสรุปหลักยังยืน: manifest ใบเดียวกัน `autonomy: level 1` + `humanApproval`
**แปลว่าคนละเรื่องบน pi-poc กับ dsh-poc** ณ เวลาที่ตรวจ
→ `portability.test.ts` จับไม่ได้ เพราะมันพิสูจน์ว่า *package* เหมือนกัน ไม่ได้พิสูจน์ว่า *พฤติกรรม* เหมือนกัน

### 5.3 `forbidden` เป็นชื่อ tool แต่ความสามารถรั่วผ่าน built-in

`dsh-base` ของ DSH mount tool มา 15 ตัวให้ทุก session รวม `tool-bash`, `tool-fs`, `tool-web`, `tool-subagent`
แม้แต่ preset `minimal` ก็ยังมี persistent bash + editor

→ `forbidden: [github.merge]` ไม่มีความหมายเมื่อโมเดลพิมพ์ `gh pr merge` ในเชลล์ได้
→ pi-adapter กันด้วย `tools: toolNames` แต่นั่นเป็นลูกเล่นเฉพาะ Pi

**การหักชื่อ tool ≠ การหักความสามารถ** ต้องมี test ที่พิสูจน์ว่า tool list ที่โมเดลเห็นจริง **เท่ากับ** `compiled.tools` เป๊ะ ไม่ใช่ superset ต่อ adapter ทุกตัว

### 5.4 จุดบังคับ policy ต่างกันตามชนิด runtime

```
หักที่ Builder (dsh-poc)   ปลอดภัยถ้า adapter ไม่พลาด — และได้ผลกับทุกชนิด
หักตอนรัน (approval hook)  ต้องมี hook — thick runtime ส่วนใหญ่ไม่มี
```

→ `forbidden` แข็งแรงกว่า `humanApproval` โดยธรรมชาติ manifest ควรทำให้เห็นความต่างนี้
ตอนนี้เขียนอยู่ข้างกันเหมือนมีน้ำหนักเท่ากัน ทั้งที่ไม่เท่า

### 5.5 subagent seam คือที่ที่ multi-vendor คุ้มจริง

DSH แก้ปัญหา runtime หลายค่ายไปแล้ว แต่ **แก้ลงล่าง ไม่ใช่แก้บน**

สัญญาของ subagent backend แคบมาก: รับ "หนึ่ง task ที่อธิบายตัวเองครบ" คืน "คำตอบสุดท้าย หรือ error"
ไม่มี tool traffic ไม่มี intermediate message ข้ามเส้น
พอสัญญาแคบขนาดนี้ ความต่างระหว่างค่าย (approval hook, tool surface, trace shape) **หายไปหมด** เพราะไม่มีอะไรต้องแมป

เทียบกับ `AgentRuntime` ของเราที่กว้างกว่ามาก ต้องแมปทุกอย่างครบทุกค่าย แล้วก็เจอ skew

→ **ข้อเสนอสำหรับ P5:** ทำ subagent seam ก่อน แล้วใช้ backend ของ DSH เป็นแบบอย่าง
seam ของ top-level runtime คือที่ที่ต้นทุนแพงที่สุดและได้ประโยชน์น้อยที่สุด

---

### 5.6 ชื่อ `dsh` แบกของสามอย่างที่ไม่เหมือนกัน

ต้องแยกเป็น **3 runtime** ไม่ใช่ 2

```
runtimes/
  openai-compatible/     ← ของที่ทีมเขียนไว้จริง (234 บรรทัด, 0 vendor dep)
      id: openai-compatible
      ยิง /chat/completions ตรง — ใช้กับ zen, DeepSeek API, llm-gateway, อะไรก็ได้
      พิสูจน์แล้วว่าใช้งานได้จริง เก็บไว้ทั้งดุ้น แค่เปลี่ยนชื่อ

  acp/                   ← ยังไม่มี
      id: acp
      ขับ agent ตัวไหนก็ได้ที่พูด ACP ผ่าน JSON-RPC stdio
      ได้ resume / permission / MCP attach / model select มาในสัญญาเดียว

  dsh/                   ← ยังไม่มี = acp driver + build step ของ DSH
      id: dsh
      compile: CompiledAgent → agent.cordis.yml (คุม tool set) + patch (sandbox/approval)
      drive:   ผ่าน acp
```

**ทำไม `dsh` ต้องแยกจาก `acp`** — ACP อย่างเดียวบังคับ `forbidden` ไม่ได้ (ดูข้อ 5.3)
`dsh-base` แถม tool มา 15 ตัวให้ทุก session และ ACP ไม่มีวิธีถอดออก
จะคุม tool set ได้ต้องเขียน preset ซึ่งเป็น Cordis composition ของ DSH เอง

→ `dsh` จึงไม่ใช่ adapter ธรรมดา แต่เป็น **compiler backend + driver สองชั้น**
ซึ่ง `AgentRuntime` วันนี้แสดงออกไม่ได้ — `unsupported()` บอกได้แค่ "ทำไม่ได้"
บอกไม่ได้ว่า "ต้อง emit vendor config เป็น build artifact ก่อนถึงจะรันได้"

**ทางแก้เข้ากับ analogy ที่ README ใช้อยู่แล้ว** — `gcc --target`: ไฟล์ `.c` เหมือนเดิม
แต่ได้ `.o` คนละแบบต่อ target ตอนนี้ `.agentpkg.json` เป็น target-independent ล้วน
ควรมีส่วน **target-specific object** เพิ่ม โดย manifest กับ checksum ยังเท่าเดิม portability ไม่เสีย

**สิ่งที่การเปลี่ยนชื่อกระทบ** (ไม่ใช่แค่ cosmetic)

| | |
|---|---|
| DoD ข้อ 5 `DSH Runtime ✅` | กลายเป็นข้อที่ยังว่าง — และควรเป็นแบบนั้น |
| `builder/registry/runtimes.ts` | ไฟล์เดียวที่ต้องแก้ ตามที่ `docs/runtime-adapter.md` เขียนไว้ — ถูกแล้ว |
| `--target dsh` ใน README/docs/ตัวอย่าง | ต้องอัปเดต หรือทำ alias ช่วงเปลี่ยนผ่าน |
| `dsh-runtime.test.ts` | เปลี่ยนชื่อตาม เพราะสิ่งที่ทดสอบคือ loop แบบ OpenAI-compatible ไม่ใช่ DSH |
| `portability.test.ts:63` | assert ว่า package JSON ต้องไม่มีคำว่า `deepseek-harness` — ยังใช้ได้ ไม่ต้องแตะ |

---

## 6. ลำดับงานที่เสนอ

```
0. เปิด issue ที่ ecosystem-brief ก่อน            ← ดูข้อ 8
1. dsh-poc = ฐานของ agent-builder-poc
2. แยก runtime เป็น 3: openai-compatible / acp / dsh  ← ดูข้อ 5.6
     ตอนนี้ทำแค่ข้อแรก (เปลี่ยนชื่อ) ก็หยุดเคลมความครอบคลุมที่ยังไม่มีได้แล้ว
3. retry + fallback chain + audit sink            ← ทำก่อน ไม่งั้น P5/P6 ไปต่อบนพื้นที่ยังพัง
4. unsupported() ต้อง fail build ไม่ใช่ warn      ← ปิดช่อง semantic skew ที่มีอยู่แล้ว
5. ย้าย pi → runtimes/pi/adapter.ts
      - เพิ่ม unsupported() + RunContext
      - ลบ resolveModel().catch()
      - บังคับ MCP ผ่าน mcp-client.ts
      - ผ่าน conformance.test.ts  ← acceptance test ของการรวม
6. ลบ spec.runtime ออกจาก manifest ทุกตัวของ pi
7. resume() — ทั้งคู่ยัง throw ต้องมีก่อนทำ P5
8. subagent seam (P5) — ดูข้อ 5.5
```

### สิ่งที่ต้องทำก่อนมี adapter ตัวที่ 3 (ไม่ว่าจะเป็นตัวไหน)

| | |
|---|---|
| `unsupported()` → **fail build** | manifest ที่บอกว่า "ต้องขออนุมัติ" แล้วรันบน runtime ที่ไม่มี approval = security bug ไม่ใช่ degraded mode |
| conformance ต้องรันทุก adapter กับ stub — **ห้าม skip** | ตอนนี้ skip 5 ตัวเพราะไม่มี credential พอมี 8 runtime เมทริกซ์จะเต็มไปด้วย "ไม่รู้" ที่หน้าตาเหมือน "ผ่าน" |
| ย้าย model resolution + tool-name mapping ออกจาก adapter | ทำแบบเดียวกับที่ `mcp-client.ts` ทำกับ MCP แล้วสำเร็จ — ทำให้ "ลืมไม่ได้" |
| adapter เป็น package แยก | dsh มี 0 vendor dep · pi ลาก pi-ai + pi-coding-agent (pin exact `0.84.4`) มา คูณหลายค่ายใน node_modules เดียวกัน |
| capability matrix generate จากผล conformance | เอกสารที่เขียนมือจะโกหกภายในสองเดือน |

### สิ่งที่หยิบใช้ได้เลยโดยไม่ต้องรอ

- **`@earendil-works/pi-telemetry`** — _"Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas"_ คือปัญหา trace/audit contract ที่เราจะเจอ มีคนแก้ไว้แล้วและตั้งใจให้ vendor-neutral **อ่านก่อนประดิษฐ์ `TraceEvent` เอง**
- **`#tool=a&tool=b` scoping** (จาก gatekeeper-mcp ของ cloudflare-os) — ส่ง allowlist ไปที่ MCP layer แทนที่จะกรองหลัง `listTools()` กลับมา ตอนนี้ `mcp-client.ts` ต่อ → list → กรอง แปลว่า tool ที่ forbid **มีอยู่จริงในการเชื่อมต่อ** แค่ไม่ถูกยื่นให้โมเดล

---

## 7. ที่ยังไม่ได้พิสูจน์

- **DSH ตัวจริง** — ✅ ทำแล้ว ดูข้อ 9
- **ACP มีเจ้าอื่นรองรับแล้วแค่ไหน** — ถ้ามีเยอะ การเขียน ACP adapter ตัวเดียวคุ้มกว่าเขียนราย vendor มาก ยังไม่ได้ตรวจ
- **cloudflare-os** — อ่านโค้ดอย่างเดียว ยังไม่ได้รัน (พักไว้ตามที่ตกลง)
- **P6 Issue → PR** — ยังไม่แตะ

### ข้อจำกัดของ opencode zen ที่เจอระหว่างทดสอบ

- rate limit **แยกรายโมเดล** ไม่ใช่รายบัญชี
- ทำ tool call ได้: `mimo-v2.5-free`, `laguna-s-2.1-free`, `nemotron-3-ultra-free`
- ใช้ไม่ได้: `ling-3.0-flash-fin-free` (endpoint unavailable) · `muse-spark` (500) · `nemotron-3.5-lightning-free` (ไม่ยอมเรียก tool พ่น chain-of-thought แทน) · `hy3-free` (มีใน catalog pi-ai แต่ zen บอก not supported)
- เจอ 502/503 บ่อย — **free tier ไม่เสถียรพอสำหรับ CI** ต้องมี retry ก่อนใช้จริง

---

## 8. เรื่อง ecosystem-brief

**Capability Index ยังไม่มีบรรทัด "Agent Manifest / agent build"** ทั้งที่มีสองรีโปทำเรื่องเดียวกันอยู่
ตรงกับอาการที่ brief เขียนไว้เองว่าอยากป้องกัน

ตาม `ai/context.md` (hard rule: _"Never create a new repo to dodge a boundary. Propose it instead."_)
→ ควร **เปิด issue ที่ `ecosystem-brief` ก่อนสร้าง `agent-builder-poc`**
ให้ `agent-platform` (L3) ตัดสินว่าจะรับ Manifest contract นี้ไปเป็นเจ้าของไหม
ไม่งั้นคือการสร้าง repo ที่ 220 แบบเงียบ ๆ ซึ่งเป็นสิ่งที่ hard rule ห้ามตรง ๆ

**B1** ผ่านแล้วฝั่ง dsh (`zen → [gateway]`) ส่วน pi ยังยิง pi-ai ตรง — ข้อนี้หายเองตอนย้ายเป็น adapter
เพราะ model resolution จะกลับไปอยู่ที่ Builder

**Open question ของ brief เรื่อง `cloudflare-os` อยู่ชั้นไหน** — คำตอบคือทั้งสอง และนั่นคือเหตุผลที่ตอบยาก
มันเป็น environment ที่มี runtime อยู่ข้างใน พร้อม security model ของตัวเอง
ต้องแยกว่าจะใช้เป็น **application** (ทีมใช้งาน) หรือเป็น **deployment target** (ส่ง agent ไปลง) — คนละชั้นกัน


---

## 9. ผล spike: DeepSeek Harness ตัวจริงผ่าน ACP

รันจริงเมื่อ 2026-09-02 · `@deepseek-ai/dsh@0.1.2-alpha.4` · `dsh-acp-app@0.1.2-alpha.4`
ACP client เขียนเอง (raw ndjson JSON-RPC) · โมเดล `nemotron-3-ultra-free` ผ่าน opencode zen

### 9.1 ติดตั้ง — ต้องใช้ pnpm

| | ผล |
|---|---|
| `npm install @deepseek-ai/dsh` | ❌ 30+ นาที แล้ว **OOM** (`JavaScript heap out of memory`) สองรอบ |
| `pnpm add @deepseek-ai/dsh` | ✅ **12.9 วินาที** (504 packages, 253 MB) |

npm พังตอนสร้าง flat tree ในหน่วยความจำ · pnpm ใช้ content-addressable store + symlink

### 9.2 ชี้ DSH ไป opencode zen ได้ — เป็น config ล้วน ไม่แก้โค้ด

```yaml
- id: llm-pi-ai
  config:
    providers:
      zen:
        apiKeyEnv: OPENCODE_ZEN_API_KEY
        baseURL: https://opencode.ai/zen/v1
        api: openai-completions
        models: [{id: nemotron-3-ultra-free, contextWindow: 200000}]
- id: agent-default-model      # หรือ id: acp สำหรับ profile acp
  config: {provider: zen, model: nemotron-3-ultra-free}
```

```
$ dsh --profile headless --patch ./zen-headless.cordis.patch.yml \
      "Reply with exactly: DSH-ON-ZEN-OK. Do not use any tools."
DSH-ON-ZEN-OK
```

ACP คืน config option กลับมาเป็น select โดยมี zen อยู่ข้าง model ของ DeepSeek เอง
`currentValue: ["zen","nemotron-3-ultra-free"]` — เปลี่ยนกลางคันได้ด้วย `session/set_config_option`

### 9.3 ACP ใช้งานได้ครบ

```
✓ initialize
   agentCapabilities: {"mcpCapabilities":{"http":true},
                       "sessionCapabilities":{"close":{},"list":{},"resume":{}}}
✓ session/new (+MCP over HTTP + bearer)
✓ session/prompt        stopReason: end_turn
✓ session/list -> 5 resumable
✓ session/request_permission  (ดูข้อ 9.5)
```

**`resume` ได้มาฟรีจากโปรโตคอล** — เป็นสิ่งที่ทั้งสอง PoC ยัง `throw` อยู่

### 9.4 capability leak — ยืนยันด้วยการรัน ไม่ใช่การอ่าน

ให้ agent ลิสต์ tool ตัวเอง ได้ **40 ตัว**:

```
bash  write  edit  read  glob  grep  web_fetch  web_search
subagent  subagent_fork  ralph  workflow  skill  str_replace_editor
todo_write  goal/job/agent-control ...                          ← built-in 25 ตัว

mcp__collaboration__get_workspace_context
mcp__collaboration__post_message
mcp__collaboration__resolve_decision        ← ตัวที่ manifest สั่ง forbidden
...                                                              ← MCP ครบ 15 ตัว
```

→ **`policy.forbidden` ตามชื่อ tool บังคับไม่ได้ผ่าน ACP** MCP มาครบทุกตัวรวมตัวที่ห้าม
→ **ชื่อ tool เป็นแบบที่สาม**: `mcp__collaboration__resolve_decision`
   เทียบ `collaboration.get_tasks` (dsh-poc) และ `collab_get_tasks` (pi-poc)
   policy rule ที่เขียนด้วยชื่อใน manifest จะไม่ตรงกับชื่อที่โมเดลเห็น

### 9.5 การบังคับสามชั้นที่ไม่ทดแทนกัน

ทดสอบด้วย `DSH_PERMISSION_MODE=read-only` (โหมดเข้มสุดที่ DSH ship มา) ทั้งสามเคส:

| ทดสอบ | ผล |
|---|---|
| `write` ไฟล์ ผ่าน **headless** (ไม่มี approval answerer) | ❌ `[sandbox: file access denied under read-only mode]` escalate ไม่ผ่าน **fail closed** ไฟล์ไม่ถูกสร้าง |
| `bash` + `curl https://example.com` | ✅ **รันได้ HTTP 200** |
| `write` ไฟล์ ผ่าน **ACP** (client auto-approve) | ✅ **ไฟล์ถูกสร้าง** |

ลำดับเหตุการณ์เคสที่สาม:

```
· tool_call        write {"file_path":"acp-approval-test.txt","content":"APPROVED"}
· tool_call_update status: failed                      ← sandbox ปฏิเสธ
· tool_call        write {..., "sandbox_permissions":"workspace-write",
                          "justification":"..."}       ← agent ขอ escalate เอง
⚑ request_permission  options=allow_once,reject_once → answering allow_once
· tool_call_update status: completed                   ← ไฟล์ถูกสร้าง
```

สรุปเป็นตาราง:

```
ชื่อ tool  (forbidden)     ← ต้องคุมที่ preset เท่านั้น · ACP ทำไม่ได้
effect ไฟล์ (sandbox)      ← DSH_PERMISSION_MODE บังคับได้ และ fail closed จริง
เน็ต / exec               ← ไม่มีใครคุม ต้องขังนอก process
```

**ข้อสรุปที่กระทบ manifest โดยตรง:**

1. เคส `forbidden: [github.merge]` แล้วโมเดลพิมพ์ `gh pr merge` **ยังยืนอยู่ และยืนแม้ในโหมดเข้มสุด**
   agent ที่มี `bash` + เน็ต เรียก HTTP API อะไรก็ได้โดยไม่แตะ tool ชื่อนั้นเลย
   → manifest ที่มี `tools.allowed` แล้วคิดว่าปลอดภัย เป็นความเข้าใจผิดเชิงระบบ
   ตราบใดที่ runtime ปลายทางแถมเชลล์มาให้
2. **client ที่ตอบ approval อัตโนมัติ ทำให้ sandbox กลายเป็นแค่คำแนะนำ**
   `--approve auto` ของเราจะปลด `read-only` ของ DSH ให้เป็น `workspace-write` เงียบ ๆ
   ตามคำขอของ agent เอง → ถ้าทำ acp adapter ต้องกำหนดว่า autonomy level ไหน
   ถึงจะยอมตอบ `allow_once` ให้คำขอ escalate **ไม่ใช่ยกให้ `--approve` ตัดสินอย่างเดียว**
3. `autonomy.level` ควรแมปไป `DSH_PERMISSION_MODE` (`read-only` / `workspace-write` /
   `danger-full-access`) เพราะนั่นคือชั้นที่บังคับได้จริง ส่วน `forbidden` รายชื่อยังต้องใช้ preset

### 9.6 ความเสี่ยงเรื่องเวอร์ชัน — ACP อยู่แค่ช่อง alpha

```
Error: stdio app: the launcher must provide ctx.appExit and ctx.appReady
       before the tree mounts
```

| package | latest | alpha |
|---|---|---|
| `@deepseek-ai/dsh` | 0.1.1-rc.2 | 0.1.2-alpha.4 |
| `@deepseek-ai/dsh-acp-app` | 0.1.2-alpha.2 | 0.1.2-alpha.4 |

`dsh-acp-app` ไม่มีเวอร์ชันไหนเข้ากับ `dsh` ตัว `latest` ได้เลย — **ช่อง latest รัน ACP ไม่ได้**
ต้องขึ้น alpha ทั้งคู่ และ npm ที่ published ยังไม่ ship template ของ profile `acp`
(`PROFILE_TEMPLATES` มีแค่ `web` กับ `headless`) ต้องสร้างเองด้วย
`dsh plugin --profile acp add @deepseek-ai/dsh-acp-app@<version ตรงกัน>`

→ **เหตุผลสนับสนุนให้ adapter ผูกกับ ACP spec ไม่ใช่ผูกกับ DSH**
และต้องทดสอบกับ agent เจ้าอื่นที่พูด ACP ด้วย ไม่ใช่ DSH ตัวเดียว

### 9.7 ไฟล์ที่ใช้ทำ spike

`acp-spike.mjs` (ACP client แบบ raw ndjson ~110 บรรทัด) · `zen.cordis.patch.yml` ·
`zen-headless.cordis.patch.yml` · `zen-mcp.cordis.patch.yml`
ยังไม่ได้ commit เข้า repo — อยู่ในพื้นที่ชั่วคราวของ session ถ้าจะเก็บต้องย้ายเข้ามา


---

## 10. ผลการรวม `agent-builder-pi-poc` เข้ามาเป็น runtime `pi`

ทำเมื่อ 2026-09-02 · `runtimes/pi/adapter.ts` · Pi `0.84.4`

### 10.1 ผลรวม

```
npm test    64 passed (64)          ← เดิม 45 passed · 5 skipped
```

conformance เพิ่มจาก 14 เป็น 21 เคส และ **ไม่มี skip เหลือ** เพราะ suite ยก stub
OpenAI-compatible ขึ้นบน 127.0.0.1 แล้วชี้ `LLM_GATEWAY_BASE_URL` ไปที่นั่น
ทั้ง `dsh` และ `pi` จึงเข้า `OFFLINE_RUNTIMES` ได้ — "ต้องใช้ key" ไม่ใช่เหตุผลที่จะข้ามอีกต่อไป
(ตรงกับที่ข้อ 6 เสนอไว้ว่า runtime ที่ไม่มีใครทดสอบ หน้าตาเหมือน runtime ที่ผ่าน)

portability ยังจริงข้าม 3 target:

```
$ build code-reviewer.yaml --target mock | dsh | pi
identical across mock/dsh/pi: True
```

รันจริงกับ opencode zen + MCP `collaboration` ตัวจริง:

```
$ run manifests/workspace-researcher.yaml --target pi --approve deny --trace
  ⚠ target 'pi' does not support: trace.model_step
  · model_call  {"model":"nemotron-3-ultra-free","tools":2}
  · tool_call   {"tool":"collaboration.get_workspace_context","effect":"read",...}
  · tool_result {"tool":"collaboration.get_workspace_context","chars":1256}
  · finish      {"toolCalls":1}
  (target: pi · tool calls: 1 · trace: 4 events)
```

### 10.2 ข้อสรุปที่ต้องแก้: Pi บังคับ approval ได้

ในข้อ 5.2 ผมสรุปว่า Pi honour `humanApproval` ไม่ได้เพราะไม่มี permission system
**ข้อสรุปนั้นผิด** Pi ไม่มี permission system ก็จริง แต่ adapter เป็นคนเขียน `execute`
ของทุก tool เอง จึงดักขออนุมัติก่อน side effect ได้

```
✓ asks before a gated tool and does not run it on a denial   toolCalls = 0
✓ runs a gated tool once approved                            toolCalls = 1
```

สิ่งที่ pi-poc ขาดคือ **adapter ไม่ได้ทำ** ไม่ใช่ **Pi ทำไม่ได้**

บทเรียนที่กว้างกว่านั้น: "vendor ไม่มี permission system" ≠ "บังคับ policy ไม่ได้"
ตราบใดที่ adapter ยังเป็นเจ้าของพื้นผิว tool — ซึ่งต่างจากเคส DSH-ผ่าน-ACP ในข้อ 9
ที่ tool มาจาก harness เอง adapter จึงไม่มีอะไรให้ห่อ

### 10.3 บั๊กของ pi-poc ที่ปิดโดยโครงสร้าง ไม่ใช่โดยวินัย

| pi-poc เดิม | หลังรวม |
|---|---|
| `resolveModel().catch(() => undefined)` → เงียบ ๆ ใช้ default model ของ Pi | `registerProvider()` จาก `ModelBinding` ไม่แตะ catalog ของ pi-ai เลย ไม่มีอะไรให้ fallback |
| MCP tool ถูกยัดเข้าโมเดลตรง ๆ ไม่ผ่าน policy | ผ่าน `runtimes/mcp-client.ts` ที่เดียว เหมือน `dsh` |
| Pi built-in (`read`/`bash`/`edit`/`write`) หลุดเข้ามาได้ | `noTools: "all"` + allowlist — เทสต์ assert ว่า wire เห็นแค่ `github_read`, `github_comment` |
| `wireName()` ก๊อปในแต่ละ adapter | `builder/tool-names.ts` ที่เดียว + throw เมื่อสองชื่อชนกันหลัง sanitize |
| `spec.runtime: pi` ใน manifest | ไม่มีแล้ว — `--target pi` |

### 10.4 ที่ยังไม่ได้ทำ

- **`resume()`** ยัง throw ทั้ง 3 runtime — Pi ใช้ `SessionManager.inMemory()` ทางที่ถูกคือ
  ทำผ่าน ACP (ข้อ 9.3) ไม่ใช่ต่อ session manager ของ Pi เอง
- **`unsupported()` ยังแค่เตือน ไม่ล้ม build** — ข้อ 6 ยังค้าง ตอนนี้ `pi` รายงาน
  `trace.model_step` แล้ว CLI พิมพ์ ⚠ แล้วรันต่อ ถ้าวันหน้ามี capability ที่เกี่ยวกับความปลอดภัย
  ต้องเปลี่ยนเป็นล้ม build
- ~~**retry / audit sink**~~ ✅ ทำแล้ว ดูข้อ 11 · **agent identity** (ข้อ 3.3) ยังค้าง
- **แยก `dsh` เป็น `openai-compatible` / `acp` / `dsh`** (ข้อ 5.6) ยังไม่ทำ — รอบนี้เพิ่ม `pi` อย่างเดียว


---

## 11. retry, model fallback และ audit sink

ทำต่อจากข้อ 10 · ปิดข้อ 3.1 และ 3.2

```
npm test    70 passed (70)      ← เดิม 64
```

### 11.1 run ที่ล้มเหลว ห้ามโกหกว่าไม่มีอะไรเกิดขึ้น

ปัญหาไม่ใช่ว่า free tier ไม่เสถียร แต่คือ**รูปแบบ**ของความล้มเหลว — รอบที่บันทึกไว้ในข้อ 3.1
คือ agent โพสต์ลงโต๊ะประชุมสำเร็จแล้ว step ถัดไปตาย 502 ข้อความอยู่บนกระดานจริง
แต่ CLI พิมพ์ `run failed` แก้เป็นสามชั้น:

```
429 / 408 / 5xx / เน็ตพัง  → backoff ทวีคูณแล้วลองใหม่          (builder/retry.ts)
ยังไม่ได้                   → ไล่ไป model ถัดไปใน spec.model.preferred
ยังไม่ได้อีก                 → RunAborted พา trace + toolCalls มาด้วย
                              CLI ลิสต์ tool ที่ทำงานไปแล้วออกมา   (builder/errors.ts)
```

`400`/`401` **ไม่ retry** — แปลว่า "ไม่ใช่แบบนี้" ไม่ใช่ "ไม่ใช่ตอนนี้" ลองซ้ำมีแต่เปลืองโควตา
มีเทสต์ยืนยันว่ายิงครั้งเดียวจริง

`spec.model.preferred` กลายเป็น fallback chain จริง — เดิม `resolveModel` หยิบตัวแรกที่รู้จักแล้วจบ
ตอนนี้ `resolveModelChain` คืนทั้งสาย `CompiledAgent.modelFallbacks` พาไปด้วย
fallback ที่ไม่มี key ถูกตัดออกตั้งแต่ต้นรัน **พร้อมบันทึกเหตุผล** — การเหลือ fallback เป็นศูนย์เงียบ ๆ
คือวิธีที่ run จะดูเหมือนไม่เคยมีทางเลือก

`pi` ทำ fallback ไม่ได้ (session ผูกกับ provider เดียว) จึงประกาศผ่าน `unsupported()` ว่า
`model.fallback` แทนที่จะปล่อยให้ manifest ดูเหมือนมี fallback

### 11.2 audit มีที่เก็บแล้ว

`--audit-log <file>` เขียน JSON Lines ระหว่างรัน บรรทัดแรกคือ run header
(`runId` · `manifestChecksum` · agent@version · target · model · autonomy · input)
แล้วตามด้วย event ละบรรทัดที่ผูกด้วย `runId` เดียวกัน

```
RUN   09ff81fc workspace-researcher@0.1.0 dsh model=nemotron-3-ultra-free route=gateway
EVENT model_call {"step": 0, "model": "nemotron-3-ultra-free"}
```

และถ้า manifest เขียน `audit.required: true` แต่ไม่ได้ส่ง `--audit-log` **CLI เตือน**:

```
⚠ manifest requires audit but nothing is storing it — pass --audit-log <file>
```

สัญญาที่ระบบรักษาไม่ได้ อันตรายกว่าไม่มีสัญญา — อย่างน้อยตอนนี้มันบอก

### 11.3 ที่ยังค้าง

- **agent identity** (ข้อ 3.3) — ข้อความยังขึ้นชื่อตาม bearer token ต้องแก้ที่ฝั่ง MCP server
- **`unsupported()` ยังแค่เตือน ไม่ล้ม build** (ข้อ 6) — ตอนนี้มี 3 ค่าจริงแล้ว
  (`mcp.connect`, `trace.model_step`, `model.fallback`) ทั้งหมดเป็น degradation ไม่ใช่เรื่องความปลอดภัย
  แต่กติกาว่าอันไหนล้ม อันไหนเตือน ยังไม่ได้เขียน
- **แยก `dsh` เป็น `openai-compatible` / `acp` / `dsh`** (ข้อ 5.6)
