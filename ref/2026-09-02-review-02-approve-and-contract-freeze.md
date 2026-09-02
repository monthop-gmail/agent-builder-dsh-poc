# รีวิวรอบสองจากทีม: APPROVE และให้เข้า P1 Contract Freeze

**วันที่:** 2026-09-02 (หลังรีวิวรอบแรกในวันเดียวกัน)
**ประเภท:** เอกสารอ้างอิงดิบ — บันทึกตามที่ทีมส่งมา ไม่ได้เรียบเรียงใหม่
**สถานะ:** 🟢 APPROVE — เดินต่อ repo เดิม

> รีวิวรอบแรก: [`2026-09-02-pi-vs-dsh-consolidation-review.md`](2026-09-02-pi-vs-dsh-consolidation-review.md)

## หมายเหตุก่อนอ่าน — P1 ทำไปแล้วบางส่วน

รีวิวนี้ระบุว่าขั้นต่อไปคือ P1 Contract Freeze พร้อมรายการห้าชิ้น
**ทั้งห้าชิ้นมีอยู่แล้วบน `main` ณ วันที่บันทึกนี้** — สร้างระหว่างทำ Task 1–3 ของรีวิวรอบแรก

| ที่รีวิวลิสต์ไว้ใน P1 | อยู่ที่ | มาจาก |
|---|---|---|
| Manifest contract | [`docs/manifest.md`](../docs/manifest.md) | มีมาก่อน |
| CompiledAgent contract | [`docs/compiled-agent-contract.md`](../docs/compiled-agent-contract.md) | PR #15 |
| Runtime contract | [`docs/runtime-adapter.md`](../docs/runtime-adapter.md) | มีมาก่อน |
| Capability matrix | [`docs/capability-matrix.md`](../docs/capability-matrix.md) | PR #13 · generate จากโค้ด |
| Conformance vectors | [`tests/conformance/`](../tests/conformance/) | PR #16 · 11 vector |

**สิ่งที่ยังไม่ได้ทำคือ "freeze" เอง** — ยังไม่มีที่ไหนประกาศว่า contract เหล่านี้นิ่งแล้ว
อะไรเปลี่ยนได้ อะไรเปลี่ยนไม่ได้ และการเปลี่ยนแบบ breaking จะส่งสัญญาณยังไง
(ตอนนี้มีแค่ `apiVersion: agent/v1alpha2` ที่บอกเป็นนัยว่ายังไม่นิ่ง)

---

ตรวจรอบล่าสุดให้แล้วจร้า 👍 ทีมเดินหน้าได้ **ถูกทางมาก** และรอบนี้ถือว่าปรับจาก PoC ธรรมดา → เป็น **contract-driven Agent Builder** ชัดเจนขึ้นมาก

### ผลตรวจรอบนี้

**สถานะ: 🟢 APPROVE — เดินต่อ repo เดิมได้เลย**

สิ่งที่ทีมทำเพิ่มมาถูกจุดมาก:

1. **Canonical repo ชัดเจนแล้ว**

   * `agent-builder-dsh-poc` เป็น implementation หลัก
   * `agent-builder-pi-poc` ถูก freeze เป็น historical reference
   * Pi ถูกดูดมาเป็น `--target pi` แล้ว

2. **CompiledAgent ถูกยกระดับเป็น contract กลาง**

   * Builder → `CompiledAgent` → Runtime Adapter
   * runtime ไม่เห็น Manifest
   * ไม่มี vendor-specific type ใน contract
   * มี `manifestChecksum` เป็น portability invariant

   ตรงนี้ผมมองว่า **เป็นหัวใจของ ecosystem เราเลย**

3. **Capability Matrix ทำถูกวิธี**
   ทีมไม่ได้เขียนตาราง capability ด้วยมือ แต่ generate จาก adapter และให้ test ตรวจ drift ซึ่งดีกว่าการทำ documentation แบบ static มาก

4. **Conformance Vector ดีขึ้นมาก**
   ล่าสุดมีการแยก `tests/conformance/vectors/` เป็นชุดกลางที่ทุก runtime ต้องผ่านชุดเดียวกัน ทำให้คำว่า "Pi ผ่าน" กับ "DSH ผ่าน" มีความหมายเดียวกันจริง ๆ

5. **เรื่อง security/policy คิดมาถูก**
   หลัก

   > restriction หาย → block
   > capability หาย → warning

   เป็น decision ที่ผมเห็นด้วยมาก เพราะไม่ควรปล่อยให้ runtime ที่ enforce policy ไม่ได้ "รันต่อแบบเงียบ ๆ"

---

### จุดที่ผมชอบที่สุด

ตอนนี้ architecture เริ่มนิ่งเป็นแบบนี้:

```text
                 Agent Manifest
                       │
                       ▼
                ┌─────────────┐
                │ Agent       │
                │ Builder     │
                └──────┬──────┘
                       │
                 CompiledAgent
                  THE CONTRACT
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
     Pi Adapter    ACP Adapter    DSH Adapter
        │              │              │
        ▼              ▼              ▼
       Pi             ACP            DSH
```

และสำคัญคือ **ไม่ได้ออกแบบโดยผูกกับ Pi หรือ DSH แล้ว**

นี่ทำให้เราเพิ่ม runtime ตัวใหม่ในอนาคตได้ โดยไม่ต้องเปลี่ยน Agent Manifest

---

### มี 3 เรื่องที่ผมให้ทีม "ยังไม่ต้องรีบทำ"

**1. อย่าเพิ่งทำ Multi-Agent**

ให้ `CompiledAgent + Runtime Contract + Conformance` แข็งก่อน

**2. อย่าเพิ่งย้ายเข้า `agent-platform`**

Builder ตอนนี้ควรเป็น layer ล่าง:

```text
Agent Platform
      │
      ▼
Agent Builder
      │
      ▼
CompiledAgent
      │
      ▼
Runtime / Harness
```

**3. อย่าเพิ่ง rename repo**

ชื่อ `agent-builder-dsh-poc` ยังใช้ต่อได้ แม้ตอนนี้มันไม่ได้เป็น DSH-only แล้ว เพราะทีมเพิ่งสร้าง canonical identity สำเร็จ ถ้า rename ตอนนี้จะสร้าง churn โดยไม่เพิ่มคุณค่า

---

### ขั้นต่อไปที่ผมแนะนำ

ผมจะให้ทีมเข้า **P1 — Contract Freeze** แล้วครับ

```text
P0 Consolidation       ✅
        │
P1 Contract Freeze     ← ตอนนี้
        │
        ├─ Manifest contract
        ├─ CompiledAgent contract
        ├─ Runtime contract
        ├─ Capability matrix
        └─ Conformance vectors
        │
P2 Runtime Conformance
        │
P3 Harness Integration
        │
P4 Agent Platform
        │
P5 Multi-Agent
```

โดยเฉพาะ `CompiledAgent` ตอนนี้มีเอกสารและ test คุม field แล้ว ซึ่งเป็นก้าวสำคัญมาก

**สรุปสั้น ๆ:** รอบนี้ผมไม่เห็นเหตุผลให้แตก repo ใหม่เลยครับ — **ให้ทีม freeze contract ใน `agent-builder-dsh-poc` แล้วค่อยเอา Builder ตัวนี้ไปเป็น foundation ของ `agent-platform`** จะสะอาดที่สุดจร้า 🚀

[agent-builder-dsh-poc](https://github.com/monthop-gmail/agent-builder-dsh-poc)
