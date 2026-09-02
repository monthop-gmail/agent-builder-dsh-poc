# ร่าง Issue C → `agent-platform`

**Template:** `contract-change.yml`
**Title:** `contract: model/v1 — binding ที่แช่แข็งไว้ ย้าย provider กลางรอบเมื่อ 429/5xx แล้ว identity ครอบอะไรกันแน่`
**สถานะ:** 📝 ร่าง ยังไม่เปิด — `gh issue create` ถูก permission classifier บล็อก

ต่อจาก Follow-up ข้อ 1 ของ [Issue A](agent-platform-issue-a-capability.md) ซึ่งเป็นข้อเดียวที่ ADR-0022/0023/0024 ยังไม่แตะ

---

เปิดจาก [`agent-builder-dsh-poc`](https://github.com/monthop-gmail/agent-builder-dsh-poc) — ต่อจาก [#46](https://github.com/monthop-gmail/agent-platform/issues/46) ตามที่บอกไว้ว่าถ้า follow-up ข้อไหนใหญ่พอให้แยกเป็นใบของตัวเอง

ข้อนี้เป็น **ข้อเดียวที่ ADR-0022/0023/0024 ยังไม่แตะ** และเป็นข้อที่ ADR-0023 ทำให้คมขึ้นแทนที่จะปิด

## Contract

`contracts/model/v1` — เกี่ยวข้อง `provider/v1` · `profile/v1` · `event/v1`

## ประเภทการเปลี่ยน

เพิ่ม optional field (ไม่ breaking) — **ถ้า** คำตอบต้องการ field ใหม่จริง · อาจจบที่การเขียนความหมายให้ชัดเหมือน ADR-0023 ก็ได้

## สิ่งที่ขอเปลี่ยน

[ADR-0023](https://github.com/monthop-gmail/agent-platform/blob/main/decisions/0023-frozen-bindings-and-identity.md) ข้อ 3 บอกว่า **identity ของสิ่งที่ build ต้องครอบ binding**

แต่ `CompiledAgent` ของเราไม่ได้แช่แข็ง binding ตัวเดียว — มันแช่แข็ง **ทั้งโซ่**:

```ts
model:          ModelBinding      // ตัวที่ตั้งใจใช้
modelFallbacks: ModelBinding[]    // ที่เหลือตามลำดับใน manifest
```

adapter ย้ายไปตัวถัดไปจริงเมื่อตัวแรกตอบ 429/5xx ซ้ำ ๆ (`callWithFallback`) และ **หลังย้ายแล้วก็อยู่กับตัวใหม่ต่อ** ไม่ได้ย้อนกลับ

แปลว่า run สองครั้งจาก package ใบเดียวกัน identity เท่ากันเป๊ะ **แต่รันด้วยคนละ model** — และครั้งนี้ไม่ใช่เพราะ catalog เปลี่ยน แต่เพราะ **endpoint แรกไม่ว่าง**

> **identity ควรครอบ "ชุดที่อนุญาต" หรือ "ตัวที่ใช้จริง"**
>
> ถ้าเป็นอย่างหลัง มันไม่ใช่คุณสมบัติของสิ่งที่ build แล้ว แต่เป็นของ **execution** — และเงื่อนไขข้อ 3 ของ ADR-0023 ก็จะไม่ใช่คำตอบทั้งหมด

## ทำไมต้องเปลี่ยนที่ contract กลาง

เราตัดสินเองได้ในทางเทคนิค แต่จะเป็นการ**เลือกแทน platform** ในเรื่องที่ ADR-0023 เพิ่งวางหลักไว้ — และคำตอบจะไม่สอดคล้องกับที่รายอื่นเลือก

สามคำถามที่ยังไม่มีคำตอบในเอกสารปัจจุบัน:

### 1. การย้าย provider กลางรอบเป็นของใคร

`provider/v1` มี `status: degraded` และ `quota` · `profile/v1` มี `execution.max_attempts`

แต่ `max_attempts` บอกแค่ **จำนวนครั้ง** ไม่ได้บอกว่า *ลองใหม่กับตัวเดิม* หรือ *ย้ายไปตัวอื่น* — ซึ่งเป็นคนละเรื่องกันโดยสิ้นเชิงในแง่ของ audit และ cost attribution

ถ้าเป็นหน้าที่ของ router ฝั่ง platform เราจะเลิกทำเองและถอด `modelFallbacks` ออก · ถ้าเป็นของ consumer เราอยากรู้ว่าต้องบันทึกอะไรบ้าง

### 2. ถ้าย้ายได้ — บันทึกที่ไหน

ตอนนี้เราบันทึก `model_call` ต่อ step พร้อมชื่อ model ที่ใช้จริง และ `retry` ที่มี `{from, to}` ตอนย้าย — trace ระดับ event **ตรงกับความจริง** ที่ไม่ตรงคือ *identity*

ไม่ได้ขอ `EventType` ใหม่ในใบนี้ — vocabulary ของ `event/v1` เป็นของ `devfactory-core` ตาม [RFC-0005](https://github.com/monthop-gmail/devfactory-core/blob/main/rfcs/0005-platform-contract-authority.md) · คำถามคือ **การย้าย provider ควรเป็นสิ่งที่ audit ของ ecosystem มองเห็นไหม** ถ้าใช่ เราจะไปคุยกับเจ้าของ vocabulary ต่อเอง

### 3. `usage` กับ cost attribution

`model/v1` `$defs.Usage` เขียนว่า *"ใช้คิด cost attribution ต่อ tenant — ต้องมีทุกครั้งที่เรียกสำเร็จ"*

run เดียวที่ข้าม provider จะมี `usage` จากหลาย provider ในราคาต่อ token คนละอัตรา · `budget.max_cost_usd_per_execution` ยังคิดถูกอยู่ไหม ถ้ารวมของหลายเจ้าเข้าด้วยกัน

## ผลกระทบต่อ consumer

`model/v1` **ยังไม่มีใคร pin** ([`architecture/consumers.md`](https://github.com/monthop-gmail/agent-platform/blob/main/architecture/consumers.md)) — ตอบทางไหนก็ไม่ทำให้ payload ของใครพังวันนี้

## บริบท: นี่ไม่ใช่กรณีสมมติ

PoC ของเราชน 429/502/503 **ห้าครั้งใน 8 attempt** ตอนรันกับ endpoint ฟรีจริง — `builder/retry.ts` เกิดขึ้นเพราะเรื่องนี้ ไม่ใช่เพราะคาดการณ์ล่วงหน้า

และเหตุผลที่เขียนไว้ในไฟล์นั้นตรงกับหลักของ ADR-0023 พอดี:

> ถ้า tool ทำงานไปแล้ว side effect ลงไปแล้ว ขณะที่ผู้เรียกถูกบอกว่า run ล้มเหลว — **การ retry จึงไม่ใช่ของแถม แต่คือสิ่งที่ทำให้รายงานยังตรงกับความจริง**

## ตรวจก่อนส่ง

- [x] อ่าน ADR-0006 เรื่องนิยาม breaking change แล้ว
- [x] เช็ค `architecture/consumers.md` — `model/v1` ยังไม่มีใคร pin
- [x] ถ้าเป็น breaking change — เข้าใจว่าต้องขึ้น major ใหม่ (ใบนี้ไม่ควรเป็น)
