# คำตัดสินจากทีม: freeze ที่ v1alpha2 และเกณฑ์ breaking

**วันที่:** 2026-09-02 (รอบที่สาม — ตอบคำถามสองข้อที่ค้างจากรอบสอง)
**ประเภท:** เอกสารอ้างอิงดิบ — บันทึกตามที่ทีมส่งมา ไม่ได้เรียบเรียงใหม่
**สถานะ:** ✅ ตัดสินแล้ว ทั้งเจ็ดข้อ — ทำตามแล้วใน `docs/contract-stability.md`

> รอบ 1: [`2026-09-02-pi-vs-dsh-consolidation-review.md`](2026-09-02-pi-vs-dsh-consolidation-review.md) ·
> รอบ 2: [`2026-09-02-review-02-approve-and-contract-freeze.md`](2026-09-02-review-02-approve-and-contract-freeze.md)

---

ใช่เลยจร้า 👍 ผมเห็นด้วยกับทีม และจริง ๆ **สองข้อนี้ควรตัดสินใจก่อน freeze** เพราะถ้าไม่กำหนด ตอนเอาไปต่อ `agent-platform` จะเกิด contract drift ได้ง่าย

ผมเสนอให้ตัดสินใจแบบนี้ครับ

### 1. Manifest: ยังไม่ bump เป็น `agent/v1`

**เลือก: freeze ที่ `v1alpha2` ก่อน**

เหตุผลคือเราเพิ่งกำหนด `CompiledAgent` และ conformance vectors ให้เป็นแกนกลาง ยังไม่ควรผูก "การ freeze" เข้ากับการย้ายเข้า `agent-platform`

แยกสองเรื่องออกจากกัน:

```text
Agent Manifest v1alpha2
        │
        │ stable PoC contract
        ▼
   Agent Builder
        │
        ▼
   CompiledAgent
        │
        ▼
 Runtime / Harness
        │
        ▼
 agent-platform (ภายหลัง)
```

เมื่อถึงตอน integrate `agent-platform` แล้วค่อยทำ:

```text
v1alpha2 → v1
```

โดยมี migration guide และ compatibility test รองรับ

ดังนั้นข้อความใน `docs/manifest.md` ที่บอกว่า "freeze เป็น v1 ตอนส่งมอบ agent-platform" ควรเปลี่ยนเป็นประมาณว่า:

> `v1alpha2` is the frozen contract for the current Agent Builder PoC. Promotion to `agent/v1` is a separate compatibility milestone and is not required for integration with `agent-platform`.

**ผมไม่แนะนำให้ bump ตอนนี้**

---

### 2. Breaking ของ CompiledAgent / AgentRuntime

ตรงนี้ผมแนะนำให้ใช้หลัก **semantic contract**, ไม่ใช่ดูแค่ว่า TypeScript interface เปลี่ยนหรือไม่

| การเปลี่ยน                                                            | Breaking?                  |
| --------------------------------------------------------------------- | -------------------------- |
| เพิ่ม optional field                                                  | ❌ ไม่ breaking             |
| เพิ่ม required field                                                  | ✅ breaking                 |
| เปลี่ยนความหมายของ field เดิม                                         | ✅ breaking                 |
| เปลี่ยน type ของ field                                                | ✅ breaking                 |
| ลบ field                                                              | ✅ breaking                 |
| เปลี่ยน allowed value ให้ consumer เดิมใช้ไม่ได้                      | ✅ breaking                 |
| เพิ่มค่า enum ที่ consumer ต้อง handle exhaustively                   | ⚠️ breaking                |
| เพิ่ม capability ใหม่แบบ optional                                     | ❌ ไม่ breaking             |
| เพิ่ม `unsupported()` case ที่ทำให้ของเดิม build/run ไม่ได้           | ✅ breaking                 |
| เพิ่ม `unsupported()` case แต่เป็น capability ใหม่ที่เดิมไม่เคยรองรับ | ❌ โดยตัวมันเองไม่ breaking |
| เปลี่ยน severity จาก warning → error                                  | ✅ breaking                 |
| เปลี่ยน policy ให้ restrictive ขึ้น                                   | ✅ breaking                 |

โดยเฉพาะประเด็น `unsupported()` ผมอยากให้ทีมกำหนดชัดว่า:

> **Breaking ไม่ได้วัดจากการเพิ่ม symbol แต่ดูจาก observable behavior ของ existing manifests**

เช่นเดิม:

```text
Manifest A
   ↓
build → success
```

ถ้าแก้ Builder แล้วกลายเป็น:

```text
Manifest A
   ↓
build → unsupported/error
```

นี่คือ **breaking change** แม้ TypeScript API ไม่ได้เปลี่ยนเลย

---

## สิ่งที่ผมอยากให้ทีมทำต่อ

ให้ทีมสร้าง:

`docs/contract-stability.md`

และ test ประมาณนี้:

```text
Contract Stability

Manifest
- Current frozen version: v1alpha2
- v1 promotion is separate from agent-platform integration

CompiledAgent
- additive optional fields = compatible
- required/type/semantic changes = breaking

AgentRuntime
- additive capability = compatible
- existing behavior change = breaking
- new unsupported() that rejects an existing valid manifest = breaking

Compatibility rule
- Existing conformance vectors must continue to pass
- Existing valid manifests must not become invalid
  without an explicit contract version change
```

และที่สำคัญ ผมอยากเพิ่ม **golden compatibility fixtures** อีกชั้นหนึ่ง:

```text
tests/
├── conformance/
│   └── vectors/
├── compatibility/
│   ├── manifests/
│   │   ├── v1alpha2-minimal.yaml
│   │   ├── v1alpha2-tools.yaml
│   │   └── v1alpha2-policy.yaml
│   └── compiled-agent/
│       └── ...
└── contract-stability.test.ts
```

เพื่อให้มีความหมายว่า:

> **"ถ้า Agent Builder รุ่นใหม่ทำให้ v1alpha2 manifest ที่เคย valid กลายเป็น invalid โดยไม่มี explicit version bump → test fail"**

### สรุปคำตัดสินส่งทีม

**ผมเลือก:**

1. 🟢 **Freeze Manifest ที่ `v1alpha2` ตอนนี้**
2. 🟢 `agent/v1` เป็น **promotion milestone ภายหลัง** ไม่ผูกกับการย้าย `agent-platform`
3. 🟢 ใช้ **behavioral compatibility** เป็นเกณฑ์ breaking
4. 🟢 เพิ่ม `docs/contract-stability.md`
5. 🟢 เพิ่ม automated compatibility test
6. 🟢 Shared conformance vectors = regression baseline
7. 🔴 ห้าม bump version เพียงเพราะเพิ่ม field/capability แบบ backward-compatible

แบบนี้ผมว่า **P1 Contract Freeze จะปิดได้จริง** และเราจะมีฐานที่แข็งพอที่จะเดินต่อไป **P2 Runtime Conformance → P3 Harness → P4 Agent Platform** ได้เลยจร้า 🚀
