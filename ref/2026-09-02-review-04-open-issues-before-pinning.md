# รีวิวรอบ 4 — merge #25 ได้ แต่ให้ร่าง issue ก่อนเปิดจริง

**วันที่:** 2026-09-02
**บริบท:** ตอบ P4 (`docs/agent-platform-alignment.md`, PR #25)

> บันทึกตามตัวอักษร — ดูกฎใน [`README.md`](README.md)

**สิ่งที่เกิดขึ้นตามมา**
- PR #25 merge แล้ว (`d04f614f`)
- ร่าง issue สองใบอยู่ที่ [`proposals/`](../proposals/) — **ยังไม่เปิด** รอ review wording
- ยังไม่ได้เพิ่ม `platform-contract.yaml` ตามคำสั่ง

---

ทีมแจ้งจร้า ... อันนี้ผมว่า **ทีมติดถูกจุดแล้วจร้า** และที่สำคัญคือเขา **ไม่ฝืนเขียนโค้ดเพื่อแก้สิ่งที่เป็น governance/contract decision** — ถือว่าทำถูกมาก

ผมเห็นด้วยว่า **อย่าเพิ่ง merge #25 แบบปิดงานทันที** จนกว่า issue ฝั่ง `agent-platform` จะถูกเปิดและมี decision เจ้าของ contract

### ผมเสนอให้ทำแบบนี้

**1. Merge PR #25 ได้** 🟢
เพราะ P4 discovery/analysis เป็นผลลัพธ์ที่มีคุณค่า และไม่ได้แกล้งทำ integration ที่ contract ยังไม่ตกลง

**2. เปิด issue ที่ `agent-platform` 2 ใบ** 🔴
แต่ให้ทีม **ร่าง issue แล้วส่งมาให้เราตรวจ wording ก่อนเปิดจริง**

สอง issue คือ:

#### Issue A — Capability requirement vs `model.preferred`

คำถามไม่ควรเป็น

> “จะใช้ของใคร?”

แต่ควรถามว่า:

> **Agent contract ต้องบอก “capability ที่ต้องการ” หรือ “model/provider ที่ต้องการ” และใครเป็นผู้ resolve binding?**

ผมมีแนวโน้มเลือก:

```text
Manifest
  ↓
capability requirement
  ↓
Platform / Model Registry
  ↓
resolved model
  ↓
CompiledAgent
```

เพราะมันสอดคล้องกับ architecture ที่เรากำลังทำอยู่มากกว่า และทำให้ portability ไม่ถูกผูกกับ provider

---

#### Issue B — `policy_profile` vs inline `policy.forbidden`

อันนี้สำคัญกว่าเรื่อง syntax เพราะเกี่ยวกับ **authority**

เราต้องตัดสินให้ชัดว่า:

```text
Platform Policy
       +
Agent Policy
       ↓
Effective Policy
       ↓
CompiledAgent
```

หรือ platform เป็นเจ้าของ policy ทั้งหมด

ผม **ไม่แนะนำให้มี policy สองชุดที่ต่างคนต่าง enforce**

และผมชอบแนวทางนี้:

> Platform policy เป็น fleet/tenant-level guardrail
> Agent policy เป็น agent-level restriction
> Effective policy = intersection / most restrictive result

เช่น:

```text
platform.forbidden = [shell]
agent.forbidden    = [network]

effective.forbidden = [shell, network]
```

แบบนี้แต่ละ layer มี authority ของตัวเอง และ **ไม่มีทางที่ agent จะ override platform restriction ได้**

---

### เรื่องที่ทีมบอกว่าเราจะเป็น consumer รายแรก

นี่แหละคือจุดที่ผมอยากให้ **ชะลอการ pin contract นิดหนึ่ง**

เพราะถ้าเราเป็น consumer รายแรกของ:

```text
agent/v1
  ├── provider
  ├── model
  ├── tool
  └── mcp
```

สิ่งที่เราตัดสินวันนี้จะกลายเป็น **precedent ให้ consumer รายถัดไป**

ดังนั้นผมไม่อยากให้ `agent-builder-dsh-poc` เป็นคน “เลือกแทน platform” โดยปริยาย

ให้ flow เป็น:

```text
agent-builder
      │
      │ discovers conflict
      ▼
agent-platform issue
      │
      ▼
Architecture / ADR decision
      │
      ▼
platform contract
      │
      ▼
Agent Builder integration
```

นี่จะทำให้ `agent-platform` เป็น **เจ้าของ platform contract** ตามที่ architecture เราวางไว้ตั้งแต่แรก

---

## คำสั่งที่ผมจะส่งทีมตอนนี้

**ให้ merge #25 ได้ และให้ร่าง issue 2 ใบก่อนเปิดจริง ส่งมาให้เราตรวจ**

ยังไม่ต้อง implement `platform-contract.yaml`

เพราะทีมพูดถูกมากว่า:

> **อย่าประกาศ conformance ถ้ายังไม่มี CI ที่ validate payload จริง**

นี่เป็นหลักที่ควรรักษาไว้ทั้ง ecosystem เลยจร้า

หลัง issue ทั้งสองได้รับ decision แล้ว เราค่อยกลับมาแก้ P4 integration ให้เป็น **contract-backed integration** ไม่ใช่ integration จากการคาดเดา

ถ้าทีมส่งร่าง issue #1/#2 มา ผมช่วย review ให้ละเอียดก่อนส่งได้เลยจร้า 🚀
