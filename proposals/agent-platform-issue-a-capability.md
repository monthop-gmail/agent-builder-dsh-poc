# ร่าง Issue A → `agent-platform`

**Template:** `contract-change.yml`
**Title:** `contract: agent/v1 — binding ของ model เกิดตอน build ได้ไหม หรือต้องเป็น runtime เท่านั้น`
**สถานะ:** ✅ **เปิดแล้ว 2026-09-02** → [`agent-platform#46`](https://github.com/monthop-gmail/agent-platform/issues/46) — รอ decision

> **แก้จากร่างแรก** — ร่างแรกถามว่า "capability หรือ provider" ซึ่ง **[ADR-0009](https://github.com/monthop-gmail/agent-platform/blob/main/decisions/0009-capability-model.md)
> ตัดสินไปแล้วและ Accepted** ตั้งแต่ 2026-08-17 การถามซ้ำคือขอให้เขารื้อ ADR ที่ปิดแล้ว
> และผิดกติกาใน `.github/ISSUE_TEMPLATE/config.yml` ที่บอกว่าเรื่องที่มี ADR อยู่แล้วให้ comment ที่ ADR นั้น
> คำถามจริงที่ยังไม่มีใครตอบคือ **binding เกิดเมื่อไหร่** ไม่ใช่ *ประกาศด้วยอะไร*

---

## Contract

`contracts/agent/v1` — เกี่ยวข้อง `capability/v1` · `model/v1` · `provider/v1`

## ประเภทการเปลี่ยน

เพิ่ม optional field (ไม่ breaking) — **ถ้า** คำตอบคือ "build-time binding ถูกต้อง"
ถ้าคำตอบคือ "ไม่ถูก" ก็ไม่ต้องเปลี่ยน contract เลย เราเป็นฝ่ายแก้

## สิ่งที่ขอเปลี่ยน

`model/v1` `Request.model_id` เขียนไว้ว่า:

> ห้าม hard-code รายชื่อ model ไว้ใน task schema — **ระบุตอน runtime เท่านั้น**
> การเลือก model เป็นหน้าที่ของ routing ตาม capability (ADR-0009)

`agent-builder-dsh-poc` ผลิต **`CompiledAgent`** ซึ่งเป็น package ที่ **มี model binding ติดอยู่ข้างใน
ตั้งแต่ตอน build**:

```text
manifest ──▶ Builder ──▶ CompiledAgent ──▶ runtime adapter (5 ตัว)
                          { model: { id, baseUrl, apiKeyEnv, route } ,
                            manifestChecksum: <เท่ากันทุก target> }
```

`manifestChecksum` ที่เท่ากันข้ามทุก target คือ **ข้อพิสูจน์ portability** ของเรา — ถ้า binding
ย้ายไปเกิดตอน runtime ตัวเลขนี้จะไม่ผูกกับสิ่งที่รันจริงอีกต่อไป

### คำถามที่ 1 — package แบบนี้ถูกต้องตาม ADR-0009 หรือไม่

**คำถามคือ package แบบนี้ถูกต้องตาม ADR-0009 หรือไม่** และถ้าถูก ขอให้ `agent/v1` พูดออกมาตรง ๆ
ว่า *"resolved binding บันทึกไว้ในสิ่งที่ build แล้วได้ ตราบใดที่มันมาจาก capability requirement"*
— เพราะตอนนี้ `model/v1` พูดตรงข้าม และ consumer รายถัดไปที่อ่านจะสรุปว่าเราทำผิด

### คำถามที่ 2 — ใครเป็น authority ของ `ModelBinding` ที่ resolve แล้ว และผลนั้นต้อง pin ไหม

ต่อจากคำถามแรกโดยตรง: สมมติ build-time binding ถูกต้อง

> **เมื่อ capability requirement ถูก resolve แล้ว ใครเป็น authority ของ resolved `ModelBinding`
> และผลการ resolve ต้องถูก pin / version เพื่อให้ `CompiledAgent` reproducible หรือไม่**

ปัญหาที่จับต้องได้: `manifestChecksum` ของเราคำนวณจาก **manifest** ไม่ใช่จากผลลัพธ์ของการ resolve
ถ้า catalog ฝั่ง registry เปลี่ยน (model ถูก deprecate · provider เปลี่ยน `status` เป็น `degraded` ·
มีตัวที่ถูกกว่าเข้ามา) **checksum เท่าเดิมแต่ agent รันด้วย model คนละตัว**

```text
manifest (ไม่เปลี่ยน)  ──▶  checksum เท่าเดิม
      │
      ▼
Model Registry (เปลี่ยน) ──▶  ModelBinding คนละตัว   ← ไม่มีใครเห็น
```

นี่คือ reproducibility ที่หายไปเงียบ ๆ ซึ่งเป็นอาการเดียวกับที่ ADR-0018 เพิ่งปิดในอีกเรื่องหนึ่ง

ทางที่เราเอนเอียง — **บันทึกผลการ resolve ลงใน artifact พร้อมเวอร์ชันของสิ่งที่ใช้ resolve**
(catalog version หรือ commit) ให้ checksum ครอบทั้ง *manifest* และ *binding ที่ได้*
แต่ **ใครเป็นเจ้าของเลข version นั้นเป็นคำถามของ platform ไม่ใช่ของเรา** — ถ้า catalog เป็นของ
`model-gateway` ที่ยังไม่เกิด เราอยากรู้ล่วงหน้าว่าจะ pin อะไรตอนมันเกิด

## ทำไมต้องเปลี่ยนที่ contract กลาง

แก้ฝั่งเราได้ในทางเทคนิค — เลิก freeze binding แล้วให้ adapter ไปถาม router ตอนรัน
แต่จะทำให้ **สามอย่างที่ contract กลางต้องการอยู่แล้วพังพร้อมกัน**:

| | ทำไมพัง |
|---|---|
| `manifestChecksum` | มัดผลลัพธ์กลับไปหา manifest ไม่ได้ ถ้า model เปลี่ยนได้ทุกรอบโดยไม่บันทึก |
| `min_observability_depth: step` | adapter ที่ไม่รู้ว่าจะรันบนอะไรจนถึงวินาทีสุดท้าย ประกาศ depth ล่วงหน้าไม่ได้ |
| refusal rule ของเรา | เราปฏิเสธ build เมื่อ target บังคับ restriction ไม่ได้ — ต้องรู้ target ตอน build |

และเรื่องนี้ไม่ใช่ของรีโปเราคนเดียว — `agent-fleet` `model-gateway` `agent-backend-os`
ที่ยังไม่เกิด ล้วนต้องตอบคำถามเดียวกันว่า *"agent ที่ deploy แล้ว ผูกกับ model ตอนไหน"*

## ผลกระทบต่อ consumer

ตาม [`architecture/consumers.md`](https://github.com/monthop-gmail/agent-platform/blob/main/architecture/consumers.md)
**`agent` `provider` `model` ยังไม่มีใคร pin เลย** — ไม่มี payload ของใครพังไม่ว่าตอบทางไหน

แต่นั่นแปลว่า **คำตอบนี้จะเป็น precedent** ให้ consumer รายถัดไปของทั้งสามตัว
เราจึงไม่อยากตัดสินเองในบ้านตัวเองแล้วค่อยมาขอให้รับรองทีหลัง

## Follow-up — ไม่ blocking

สามข้อนี้ **ไม่ต้องตอบก่อนตัดสินคำถามหลัก** และไม่ควรถ่วงใบนี้ — เขียนไว้เพราะเจอระหว่างอ่าน
ถ้าข้อไหนใหญ่พอจะเป็นใบของตัวเอง บอกได้ เราแยกออกไปเปิดต่างหาก


### 1. `capability_requirement.preferred` กับ fallback ตอน runtime เป็นคนละเรื่อง

`requirement.schema.yaml` เขียนว่า `preferred` = *"soft requirement — ใช้จัดอันดับ ไม่ใช่ตัดออก"*
ซึ่งเป็นการจัดอันดับ **ตอนเลือก** ส่วนที่ยังไม่มีเจ้าของคือ **ตอนที่ตัวที่เลือกไปแล้วตอบ 429/5xx กลางคัน**

`profile/v1` มี `execution.max_attempts` (ลองใหม่กี่ครั้ง) แต่ไม่มีอะไรบอกว่า *ลองใหม่กับตัวเดิม
หรือย้ายไปตัวอื่น* · `provider/v1` มี `status: degraded` และ `quota` ซึ่งดูเหมือนเป็นที่ของคำตอบนี้
มากกว่าฝั่ง agent

ถ้าการย้าย provider กลางรอบเป็นหน้าที่ของ router — **event ที่บันทึกไว้ควรบอกไหมว่าย้าย**
เพราะ audit ที่บอกว่า "รันด้วย model X" ทั้งที่ครึ่งหลังรันด้วย Y คือบันทึกที่ไม่ตรง

### 2. `tool_calling` ไม่มีใน `CapabilityId`

taxonomy 13 ตัวไม่มี `tool_calling` แต่ `model/v1` `Request.tools` และ `$defs.ToolCall` มีอยู่แล้ว
— เข้าใจว่า**ถือเป็นค่าเริ่มต้นของทุก model** ใช่ไหม ถ้าใช่ขอให้เขียนกำกับไว้
เพราะ model ฟรีหลายตัวใน registry ที่เราต่ออยู่ **ไม่รองรับ** และ `unknown = ไม่มี` ตาม ADR-0009
ทำให้เราไม่มีทางแสดงข้อกำหนดนี้ได้เลย

### 3. `capability_requirement` อยู่ทั้งใน `agent/v1` และ `profile/v1`

`profiles/README.md` บอกว่ากฎ *"`deny_capabilities` ต้องไม่ขัดกับ `capability_requirement.required`"*
เป็นกฎที่ schema จับไม่ได้ — แล้ว `required` ของ agent กับของ profile รวมกันยังไง (union? ต้องเป็น subset?)
ข้อนี้เกี่ยวกับ Issue B โดยตรง

## ตรวจก่อนส่ง

- [x] อ่าน ADR-0006 เรื่องนิยาม breaking change แล้ว
- [x] เช็ค `architecture/consumers.md` — `agent` `provider` `model` ยังไม่มีใคร pin
- [x] ถ้าเป็น breaking change — เข้าใจว่าต้องขึ้น major ใหม่

## อ้างอิงฝั่งเรา

[`docs/agent-platform-alignment.md`](https://github.com/monthop-gmail/agent-builder-dsh-poc/blob/main/docs/agent-platform-alignment.md) ·
[`docs/compiled-agent-contract.md`](https://github.com/monthop-gmail/agent-builder-dsh-poc/blob/main/docs/compiled-agent-contract.md) ·
[`docs/contract-stability.md`](https://github.com/monthop-gmail/agent-builder-dsh-poc/blob/main/docs/contract-stability.md)
