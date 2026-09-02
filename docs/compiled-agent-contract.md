# CompiledAgent — contract กลาง

`CompiledAgent` คือสิ่งเดียวที่ข้ามเส้นจาก Builder ไปหา runtime

```text
Agent Manifest          WHAT     — agent คืออะไร ควรทำอะไร
      │
      ▼
   Builder              RESOLVE  — ชื่อ → ของจริง, policy → สิทธิ์ที่เหลือ
      │
      ▼
┌───────────────┐
│ CompiledAgent │       THE CONTRACT
└───────────────┘
      │
      ▼
Runtime Adapter         EXECUTE  — เอาไปรันด้วยอะไรก็ได้
```

> ตารางฟิลด์ด้านล่างถูกตรวจด้วย [`tests/compiled-agent-contract.test.ts`](../tests/compiled-agent-contract.test.ts)
> ถ้าเพิ่มหรือลบฟิลด์ใน `CompiledAgent` แล้วไม่แก้ไฟล์นี้ **test จะล้ม**

## สองข้อที่ทำให้ contract นี้มีความหมาย

**1. runtime ไม่เคยเห็น Manifest**

`AgentRuntime` ไม่มี `validate(manifest)` และไม่มี `compile(manifest)` — adapter ที่อ่าน
manifest ได้จะค่อย ๆ งอกพฤติกรรมเฉพาะ manifest แล้ว portability ตายเงียบ ๆ

**2. ไม่มี type ของ vendor อยู่ในนี้**

`portability.test.ts` assert ว่า package ที่ build ออกมาไม่มีคำว่า vendor ไหนอยู่เลย
และ build manifest เดียวกันลงทุก target แล้วได้ผลเท่ากันทุกไบต์ (ยกเว้น `target` กับ `builtAt`)

## ฟิลด์

| ฟิลด์ | มาจาก | ทำไมต้องมี |
|---|---|---|
| `name` | `metadata.name` | ตัวตนของ agent ใน trace และ audit log |
| `version` | `metadata.version` | คู่กับ `name` เวลาอ้างถึง agent ตัวหนึ่ง |
| `description` | `metadata.description` | อธิบายให้คนอ่าน ไม่ได้เข้า prompt |
| `purpose` | `spec.purpose.primary` | agent นี้มีไว้ทำอะไร — เข้า system prompt |
| `model` | Model Registry | **ที่อยู่จริงของ model** ไม่ใช่ชื่อที่ manifest ขอ |
| `modelFallbacks` | Model Registry | ที่เหลือของ `spec.model.preferred` เรียงตามลำดับ |
| `systemPrompt` | `spec.system` + skills + purpose | prompt ที่ประกอบเสร็จแล้ว runtime ไม่ต้องประกอบเอง |
| `tools` | Tool Registry − policy | **กรองแล้ว** — forbidden ถูกหักออก autonomy ถูกใช้แล้ว |
| `skills` | Skill Registry | instruction pack ที่ resolve แล้ว |
| `mcpServers` | MCP Registry | descriptor สำหรับต่อ ไม่ใช่ tool — tool มาตอน connect |
| `autonomy` | `spec.autonomy.level` | effect ไหนที่ agent ทำเองได้โดยไม่ต้องถาม |
| `approvalRequired` | policy + autonomy | ชื่อ tool ที่ต้องมีคนกดอนุมัติทุกครั้ง |
| `policy` | `spec.policy` + `spec.humanApproval` | **กฎดิบ** พกไปด้วยเพื่อใช้กับ tool ที่โผล่ทีหลัง |
| `audit` | `spec.audit.required` | ให้ runtime ส่ง trace event หรือไม่ |
| `manifestChecksum` | sha256 ของไฟล์ manifest | **มัดผลลัพธ์กลับไปหา manifest ที่แน่นอน** |

### สามฟิลด์ที่คนมักเข้าใจผิด

**`model` ไม่ใช่ชื่อ model**

manifest เขียน `preferred: [deepseek]` แต่ `CompiledAgent.model` คือ `ModelBinding` ที่บอกว่า
model id อะไร ยิงไป base URL ไหน ใช้ env var ตัวไหนเป็น key และเดินทาง `gateway` หรือ `direct`
— Model Registry เป็นคนตัดสิน ไม่ใช่ manifest และไม่ใช่ runtime

**`tools` กรองมาแล้ว ไม่ใช่รายการที่ขอ**

`granted = allowed − forbidden` แล้วค่อยเอา autonomy มาตัดสินว่าตัวไหนต้องขออนุมัติ
adapter จึงไม่มี tool ที่ถูกห้ามให้เรียกตั้งแต่แรก — **ไม่ใช่มีแล้วห้ามเรียก**

**`policy` ถูกพกมาด้วยทั้งที่ `tools` กรองแล้ว**

เพราะ MCP server ไม่บอกว่ามี tool อะไรจนกว่าจะ connect ซึ่งเกิด**หลัง** Builder ทำงานเสร็จ
tool ชุดนั้นจึงต้องถูกกรองด้วยกฎเดียวกันตอน connect — ผ่าน `admitLateTools()` ใน
[`runtimes/mcp-client.ts`](../runtimes/mcp-client.ts) ที่เป็นทางเดียวที่ adapter ได้ MCP tool มา

## `manifestChecksum` คือ portability invariant

```text
manifest ไฟล์เดียว
      ↓
  build ทุก target
      ↓
mock · openai-compatible · pi · acp · dsh
      ↓
checksum เดียวกันหมด
```

แปลว่าพิสูจน์ได้ว่า agent ที่รันอยู่บนคนละ runtime **มาจาก definition เดียวกันจริง**
ไม่ใช่แค่ "หน้าตาคล้ายกัน" — และ audit log ทุกบรรทัดพก checksum นี้ไปด้วย

## สิ่งที่ตั้งใจไม่ใส่

| ไม่มี | เพราะ |
|---|---|
| runtime / target | runtime เป็น **build target** ไม่ใช่คุณสมบัติของ agent — เหมือน `gcc --target` ที่ไม่ได้เขียนในไฟล์ `.c` |
| credential | `model.apiKeyEnv` บอก**ชื่อ** env var ไม่ใช่ค่า — package ที่ build แล้วจึงแชร์ได้ |
| session / state | `CompiledAgent` คือ definition ไม่ใช่ instance · session เป็นของ runtime |
| MCP tool | ไม่มีจนกว่าจะ connect — ดูหัวข้อ `policy` ด้านบน |

## อ่านต่อ

- [`manifest.md`](manifest.md) — Agent Manifest ฝั่ง input
- [`runtime-adapter.md`](runtime-adapter.md) — `AgentRuntime` ฝั่ง output
- [`capability-matrix.md`](capability-matrix.md) — target ไหน honour อะไรได้บ้าง
- [`builder/types.ts`](../builder/types.ts) — type จริง เป็น source of truth
