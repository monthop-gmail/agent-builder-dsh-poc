# รีวิวจากทีม: Pi PoC เทียบ DSH PoC และข้อเสนอให้ DSH เป็นแกนกลาง

**วันที่:** 2026-09-02
**ประเภท:** เอกสารอ้างอิงดิบ — บันทึกตามที่ทีมส่งมา ไม่ได้เรียบเรียงใหม่
**สถานะ:** ข้อเสนอ ยังไม่ได้ตัดสินใจ ยังไม่ได้ลงมือ

> โฟลเดอร์ `ref/` เก็บของที่รับมาตามตัวอักษร ส่วนข้อสรุปที่ผ่านการตรวจแล้วอยู่ที่
> [`docs/poc-review-2026-09-02.md`](../docs/poc-review-2026-09-02.md)

## หมายเหตุก่อนอ่าน — ตัวเลขที่ต้องปรับ

เอกสารนี้ระบุว่า test suite อยู่ที่ 85 tests และ README เขียนว่า 45
**ณ วันที่บันทึก README เขียน 45 จริง (ผิด) แต่ของจริงคือ 111 tests** ไม่ใช่ 85 —
ตัวเลข 85 คือสถานะ ณ PR #6 ส่วน #7/#8/#10 เพิ่มมาอีก README ถูกแก้ไปพร้อมกับการบันทึกนี้แล้ว

ข้อสังเกตของทีมเรื่อง "เอกสารตามหลัง implementation" ถูกต้อง และเป็นเหตุผลที่ควรเก็บไว้

---

ผมไล่เทียบ **Pi PoC กับ DSH PoC** แล้ว และภาพตอนนี้ชัดมากว่า **ไม่ควรพัฒนา Pi PoC แยกต่อแล้ว** แต่ให้ DSH PoC เป็นแกนกลาง แล้วดูดสิ่งที่ Pi วางรากฐานไว้เข้ามาเป็นมาตรฐานเดียวกัน

## 🎯 ข้อสรุปสำคัญ

ตอนนี้ architecture ที่ผมแนะนำคือ:

```text
                    Agent Manifest
                    agent/v1alpha2
                          │
                          ▼
              ┌──────────────────────┐
              │    Agent Builder     │
              │                      │
              │ Load                 │
              │ Validate              │
              │ Resolve               │
              │ Policy                │
              │ Compile               │
              │ Package               │
              └──────────┬───────────┘
                         │
                  CompiledAgent
                  runtime-neutral
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
      PiRuntime      ACPRuntime       DSHRuntime
        │                │                │
       Pi            ACP Agent        DeepSeek
                                          Harness
        │                │                │
        └────────────────┼────────────────┘
                         ▼
                 Future Runtimes
          Claude / Gemini / Qwen / ...
```

**หัวใจคือ `CompiledAgent`** ไม่ใช่ Pi, DSH หรือ ACP

ใน DSH PoC ตอนนี้กฎนี้ถูกวางไว้ค่อนข้างดีแล้ว: runtime ได้ `CompiledAgent` และไม่ควรเห็น Manifest โดยตรง

---

# 1. Pi PoC ควรถูกมองเป็นอะไร?

ผมจะจัดสถานะประมาณนี้:

| Repo                    | บทบาท                           |
| ----------------------- | ------------------------------- |
| `agent-builder-pi-poc`  | **Original/reference PoC**      |
| `agent-builder-dsh-poc` | **Canonical Agent Builder PoC** |
| `agent-platform`        | L3 orchestration / platform     |
| `ai-collaboration-mcp`  | Collaboration/control plane     |
| `ecosystem-brief`       | Ecosystem contract/map          |

Pi PoC มีคุณค่ามาก เพราะเป็นจุดเริ่มต้นของแนวคิด:

> **Agent Manifest → Builder → Runtime Adapter → Pi**

commit แรกของ Pi ก็วาง seam นี้ไว้แล้ว

ดังนั้น **ไม่ใช่ของที่ทิ้ง** แต่เป็นของที่ถูก "ยกระดับ" ไปเป็น architecture กลาง

---

# 2. สิ่งที่ DSH PoC ทำได้เหนือ Pi PoC แล้ว

ตอนนี้ DSH PoC มี architecture ที่ mature ขึ้นมาก:

### Builder

```text
Manifest
   ↓
Loader
   ↓
Validator
   ↓
Resolver
   ↓
Policy
   ↓
Compiler
   ↓
CompiledAgent
```

Compiler ปัจจุบัน resolve:

* tools
* skills
* MCP
* autonomy
* forbidden policy
* human approval
* model chain
* audit
* manifest checksum

และผลลัพธ์ยังคง runtime-neutral อยู่

นี่เป็น evolution ที่ถูกทางจาก Pi PoC มาก

---

# 3. จุดที่ผมอยาก "ล็อก" เป็น Contract กลาง

นี่สำคัญที่สุดครับ

## Contract A — Agent Manifest

Manifest บอกว่า:

> **Agent คืออะไร และควรทำอะไร**

ไม่บอกว่า:

> Agent จะรันด้วยอะไร

ดังนั้น **ห้ามมี**

```yaml
spec:
  runtime: pi
```

หรือ

```yaml
runtime:
  type: dsh
```

เด็ดขาด

ปัจจุบัน DSH PoC ใช้หลักนี้ถูกต้องแล้ว โดย runtime เป็น `--target` ตอน build/run

---

# 4. Contract B — CompiledAgent

อันนี้ผมมองว่าเป็น **หัวใจของ ecosystem**

```text
Agent Manifest
      │
      ▼
    Builder
      │
      ▼
 ┌───────────────┐
 │ CompiledAgent │
 └───────────────┘
      │
      ├── ModelBinding
      ├── SystemPrompt
      ├── Tools
      ├── Skills
      ├── MCP
      ├── Autonomy
      ├── Approval
      ├── Policy
      ├── Audit
      └── ManifestChecksum
```

สิ่งที่ดีมากคือ `CompiledAgent` มี `manifestChecksum`

แปลว่าเราสามารถพิสูจน์ได้ว่า:

```text
Manifest เดียวกัน
      ↓
Pi
DSH
ACP
OpenAI-compatible
Mock
      ↓
มาจาก Agent definition เดียวกัน
```

นี่ควรกลายเป็น **portability invariant** ของ ecosystem

---

# 5. Contract C — Runtime Adapter

ควรยึด interface นี้เป็นมาตรฐาน:

```text
unsupported()
createAgent()
run()
resume()
```

และที่สำคัญ:

```text
Runtime
   ↑
CompiledAgent
```

ไม่ใช่

```text
Runtime
   ↑
Manifest
```

เพราะถ้า runtime อ่าน Manifest เองเมื่อไร architecture จะเริ่มแตกทันที

ปัจจุบัน DSH PoC วางกฎนี้ไว้ชัดเจนแล้ว

---

# 6. สิ่งที่ Pi ควรเอามาเป็น Runtime Conformance Test

ตรงนี้ผมว่า **ควรทำต่อทันที**

สร้างชุด manifest กลาง เช่น

```text
tests/conformance/
    observer.yaml
    reader.yaml
    proposer.yaml
    actor.yaml
    approval.yaml
    forbidden.yaml
    fallback.yaml
    audit.yaml
    mcp.yaml
```

แล้วเอาไปทดสอบทุก runtime:

```text
                    observer.yaml
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
       Pi               ACP              DSH
        │                │                │
        └────────────────┼────────────────┘
                         ▼
                 Conformance Tests
```

---

# 7. Runtime ไม่จำเป็นต้องเหมือนกัน 100%

อันนี้ DSH PoC คิดถูกแล้ว

ให้ Runtime บอก:

```text
unsupported(compiled)
```

แล้ว Builder/registry ตัดสินว่าเป็น

```text
BLOCK
หรือ
DEGRADE
```

ตัวอย่าง:

```text
policy.forbidden
    ↓
DSH ทำไม่ได้
    ↓
BLOCK
```

แต่

```text
model.fallback
    ↓
runtime ทำไม่ได้
    ↓
DEGRADE / WARN
```

แนวคิดนี้ดีมาก เพราะทำให้ ecosystem **ไม่โกหกเรื่อง portability**

---

# 8. ผมอยากเพิ่มอีก 1 Contract: Capability Matrix

ตอนนี้เรามี runtime หลายตัวแล้ว ควรทำตารางกลาง:

| Capability     | Mock | Pi | OpenAI |    ACP |       DSH |
| -------------- | ---: | -: | -----: | -----: | --------: |
| model          |    ✅ |  ✅ |      ✅ |      ✅ |         ✅ |
| local tools    |    ✅ |  ✅ |      ✅ |     ⚠️ |        ⚠️ |
| MCP            |    ✅ |  ✅ |      ? |     ⚠️ |        ⚠️ |
| forbidden      |    ✅ |  ✅ |      ✅ |      ❌ |         ❌ |
| human approval |    ✅ |  ✅ |      ? |     ⚠️ |        ⚠️ |
| autonomy       |    ✅ |  ✅ |      ✅ |     ⚠️ |        ⚠️ |
| audit          |    ✅ |  ✅ |      ? |      ? |         ? |
| resume         | mock |  ? |      ? |      ✅ | ✅/planned |
| sub-agent      |    ❌ |  ? |      ? | vendor |    vendor |

โดยให้ source of truth อยู่ใน:

```text
builder/registry/capabilities.ts
```

ไม่ใช่กระจายอยู่ตาม adapter

---

# 9. Manifest v1 — ผมแนะนำให้เตรียมเลย

ตอนนี้ schema เป็น `agent/v1alpha2` และมี foundation ที่ดีแล้ว เช่น purpose/model/autonomy/system/tools/skills/MCP/policy/approval/audit/subagents

ผมแนะนำ roadmap:

```text
v1alpha2
   │
   │ stabilize
   ▼
agent/v1
```

โดย v1 ควรล็อก concept เหล่านี้:

```yaml
apiVersion: agent/v1
kind: Agent

metadata:
  name:
  version:
  description:

spec:
  purpose:

  model:
    preferred:

  system:
    instructions:

  tools:
    allowed:

  skills:

  mcp:
    servers:

  autonomy:
    level:

  policy:
    forbidden:

  humanApproval:
    required:

  audit:
    required:

  subagents:
```

**อย่าเพิ่ม runtime ลงไป**

---

# 10. สิ่งที่ควรแยกออกจาก Manifest

อีกจุดที่สำคัญมาก:

### Manifest

```text
WHAT
```

### Builder

```text
HOW TO RESOLVE
```

### Runtime

```text
HOW TO EXECUTE
```

### Agent Platform

```text
HOW TO MANAGE
```

### Collaboration MCP

```text
HOW AGENTS / TEAMS COLLABORATE
```

### Harness

```text
HOW AN AGENT ACTUALLY OPERATES
```

นี่จะทำให้ ecosystem ที่เราคุยกันช่วงก่อน ๆ ต่อกันได้สวยมาก

---

# 11. Roadmap ที่ผมแนะนำให้ทีมทำ

## P0 — Consolidation

**ตอนนี้**

* [x] Pi Builder concept
* [x] runtime-neutral CompiledAgent
* [x] Pi runtime
* [x] OpenAI-compatible
* [x] ACP
* [x] DSH
* [x] policy
* [x] autonomy
* [x] portability
* [x] resume foundation
* [x] conformance tests

**ทำต่อ**

* [ ] ย้าย test vectors เป็นชุดกลาง
* [ ] ตรวจ duplicate ระหว่าง Pi/DSH
* [ ] DSH เป็น canonical
* [ ] Pi repo freeze/reference

---

## P1 — Contract Freeze

```text
Agent Manifest v1
       +
CompiledAgent Contract
       +
AgentRuntime Contract
       +
Capability Registry
```

ตรงนี้ **อย่ารีบเพิ่ม feature**

ให้ contract นิ่งก่อน

---

## P2 — Runtime Conformance

ทดสอบ manifest เดียวกัน:

```text
             ┌── Pi
Manifest ────┼── ACP
             ├── DSH
             ├── OpenAI
             └── Mock
```

แล้วตรวจ:

```text
checksum
tools
policy
autonomy
model
approval
audit
```

---

## P3 — Harness Integration

ตรงนี้ค่อยเอา

* DeepSeek Harness
* Pi
* Claude
* Gemini
* Qwen
* vendor coding agents

เข้ามาเป็น runtime/harness ecosystem

**ไม่แก้ Manifest เพื่อรองรับแต่ละตัว**

---

## P4 — Agent Platform

จากนั้นค่อยส่ง contract ขึ้น:

```text
agent-builder-dsh-poc
          │
          │ Agent Contract
          ▼
     agent-platform
          │
          ├── lifecycle
          ├── registry
          ├── deployment
          ├── sessions
          ├── orchestration
          └── multi-agent
```

---

## P5 — Multi-Agent

ตอนนี้ค่อยเปิด:

```yaml
subagents:
  - name: researcher
    role: research

  - name: coder
    role: implementation

  - name: reviewer
    role: review
```

แล้วให้ Agent Builder compile ได้เป็น graph/agent topology

**ไม่ควรทำก่อน contract เดี่ยวแข็งแรง**

---

# 12. แล้ว Pi repo ทำอย่างไร?

ผมไม่แนะนำให้ลบทิ้งครับ

ให้ README ระบุประมาณ:

```text
agent-builder-pi-poc

Historical / Reference PoC

This repository established the original
Agent Manifest → Builder → Pi Runtime architecture.

The canonical implementation has moved to:

agent-builder-dsh-poc
```

แล้ว:

```text
Pi PoC
   │
   └── historical reference

DSH PoC
   │
   └── canonical implementation
```

แบบนี้ Git history และความคิดต้นฉบับยังอยู่ครบ

---

# 🚀 สิ่งที่ผมคิดว่าน่าทำ "ทันที"

ผมให้ทีมเดินเป็น **3 งานเท่านั้น** ก่อน:

### Task 1 — Canonicalize

> `agent-builder-dsh-poc` = canonical Agent Builder implementation

### Task 2 — Contract Freeze

สร้าง:

```text
docs/
  agent-manifest-v1.md
  compiled-agent-contract.md
  runtime-contract.md
  capability-matrix.md
```

### Task 3 — Conformance

สร้าง:

```text
tests/conformance/
```

แล้วให้ Pi / ACP / DSH / OpenAI-compatible / Mock ใช้ test vectors เดียวกัน

---

## 🔥 และมี 1 เรื่องที่ผมอยากให้ทีมแก้ทันที

README ของ DSH ตอนนี้ยังบอกว่า:

> `npm test` ผ่าน **45 test**

แต่จากสถานะล่าสุดที่เราเจอก่อนหน้านี้ test suite ขยับไป **85 tests** แล้ว

ดังนั้นควรแก้ documentation ให้ตรงกับ implementation ก่อน เพื่อไม่ให้ `ecosystem-brief` และ agent อื่นอ่านข้อมูลเก่า

---

### ภาพสุดท้ายที่ผมอยากให้ ecosystem ไปถึง

```text
                         ECOSYSTEM
                            │
                    ┌───────▼────────┐
                    │ Agent Manifest │
                    │   WHAT / v1    │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ Agent Builder  │
                    │ resolve/policy │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ CompiledAgent  │
                    │  THE CONTRACT  │
                    └───────┬────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
       Runtime           Harness           Future
       Adapter            Adapter           Adapters
          │                 │                 │
       Pi / ACP          DSH / Pi         Claude...
       OpenAI            Qwen...           Gemini...
          │                 │                 │
          └─────────────────┼─────────────────┘
                            ▼
                     Agent Platform
                            │
                  ┌─────────┼─────────┐
                  ▼         ▼         ▼
              Lifecycle  Sessions  Multi-Agent
                            │
                            ▼
                  AI Collaboration MCP
                            │
                            ▼
                     Human + Teams
```

**นี่ผมว่าเป็นจุดที่ Pi + DSH + Harness + Agent Manifest + Agent Platform ที่เราคุยกันมาหลายวัน เริ่มกลายเป็น architecture เดียวกันจริง ๆ แล้วจร้า** 🚀

[agent-builder-pi-poc](https://github.com/monthop-gmail/agent-builder-pi-poc) · [agent-builder-dsh-poc](https://github.com/monthop-gmail/agent-builder-dsh-poc)
