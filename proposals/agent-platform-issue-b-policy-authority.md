# ร่าง Issue B → `agent-platform`

**Template:** `contract-change.yml`
**Title:** `contract: agent/v1 — กฎ "สามฝ่ายตกลงตรงกัน" ให้ที่อยู่กับฝ่าย agent แค่ครึ่งเดียว`
**สถานะ:** 📝 ร่าง ยังไม่เปิด

> **แก้จากร่างแรก** — ร่างแรกเสนอ *"effective policy = ผลที่เข้มกว่า"* ราวกับเป็นเรื่องใหม่
> ความจริงคือ **`agent-platform` เขียนกฎนี้ไว้แล้ว** ใน `contracts/profile/v1/profile.schema.yaml`
> เอง (ไม่ใช่แค่ใน README):
>
> > profile เป็น "เพดาน" ไม่ใช่ "การอนุญาต" — สิทธิ์จริงคือส่วนที่ profile, agent
> > และ policy ของ tenant ตกลงตรงกันทั้งสามฝ่าย **ค่าที่กว้างที่สุดชนะไม่ได้**
>
> พร้อมกฎประกอบใน `profiles/README.md`: `deny` ชนะ `allow` เสมอ · `extends` ทำให้แคบลงได้อย่างเดียว ·
> `tools.allow` ว่าง = ไม่อนุญาตอะไรเลย
>
> ข้อเสนอของเราตรงกับของเขาเป๊ะ **จึงไม่มีอะไรให้ตัดสิน** สิ่งที่เหลือคือช่องว่างที่แคบกว่ามาก
> แต่จับต้องได้กว่า — ดูข้างล่าง

---

## Contract

`contracts/agent/v1` — เกี่ยวข้อง `profile/v1` · `policy/v1`

## ประเภทการเปลี่ยน

เพิ่ม optional field (ไม่ breaking)

## สิ่งที่ขอเปลี่ยน

กฎบอกว่าสิทธิ์จริงมาจากการตกลงกันของ **สามฝ่าย** — profile · agent · policy ของ tenant

แต่ใน `agent.schema.yaml` ฝ่าย agent มีที่ให้เขียนแค่:

| field | ความหมายตาม schema |
|---|---|
| `tools` | *"tool ที่ agent นี้ **ขอ** ใช้ — การอนุญาตจริงเป็นของ policy"* |
| `policy_profile` | **ชื่อ** ของเพดานที่ใช้ |

แปลว่า agent **ขอสิทธิ์ได้ แต่สละสิทธิ์ไม่ได้** — ไม่มี field ไหนให้เขียนว่า
*"ถึงเพดานจะเปิดให้ แต่ agent ตัวนี้ห้ามแตะ"*

ขอเพิ่ม field optional บน `agent/v1` ที่ **ตัดออกได้อย่างเดียว**:

```yaml
policy:                        # optional · deny-only ตามนิยาม
  deny_tools:      [github.pr.merge]
  deny_capabilities: [shell]
  require_human_for: [github.pr.comment]
```

ตั้งใจให้เป็นชื่อและรูปเดียวกับ `profile/v1.policy` ที่มีอยู่แล้ว (`deny_capabilities` ·
`require_human_for`) เพื่อให้การรวมเป็น union ตรง ๆ ไม่ต้องแปลงศัพท์

**ไม่ขอ `allow` ทุกชนิด** — เราพิจารณาแบบที่ agent เขียน `allow` เองได้แล้ว **และปฏิเสธ**
ถ้ามี `allow` ฝั่ง agent กฎ "กว้างที่สุดชนะไม่ได้" จะถูกละเมิดทันที และ agent จะผ่อน
ข้อจำกัดของ tenant ได้ = guardrail ไม่มีความหมาย · การที่ field นี้ **ตัดออกได้อย่างเดียว
โดยนิยาม** คือสิ่งที่ทำให้มันปลอดภัยพอจะเพิ่ม

## ทำไมต้องเปลี่ยนที่ contract กลาง

ตอนนี้ manifest ของเราเขียนแบบนี้ และมัน**ไม่มีที่ลงใน `agent/v1`**:

```yaml
spec:
  autonomy: { level: 2 }
  policy:      { forbidden: [github.merge] }
  humanApproval: { required: [github.comment] }
```

น่าสนใจว่าข้อห้ามของเราเป็นข้อเดียวกับที่ profile `coding-agent` เขียนไว้แล้ว
(`deny: github.pr.merge` — *"merge เป็นของคน ไม่ใช่ของ agent"*) เราค้นพบมันแยกกัน
และได้คำตอบเดียวกัน ซึ่งเป็นหลักฐานว่ากฎนี้เป็นของจริง ไม่ใช่ความชอบส่วนตัวของฝั่งใดฝั่งหนึ่ง

ทางเลือกอื่นที่เราพิจารณาแล้วไม่เอา:

| ทางเลือก | ทำไมไม่เอา |
|---|---|
| สร้าง profile ใหม่ต่อ agent หนึ่งตัว | profile คือ *ประเภทงาน* ไม่ใช่ *ตัวตน* — จะได้ profile บวมตามจำนวน agent |
| เก็บ `policy` ไว้ในบ้านเราเฉย ๆ | เท่ากับมี policy สองชุดที่ต่างคนต่าง enforce ซึ่งเป็นสิ่งที่ทั้งสองฝ่ายบอกว่าไม่ต้องการ |
| ตัด `policy.forbidden` ออกจาก manifest | breaking change ของ `agent/v1alpha2` และทำให้ manifest อ่านแล้วไม่รู้ว่าตัวเองถูกจำกัดอะไร |

## ผลกระทบต่อ consumer

`agent/v1` และ `profile/v1` **ยังไม่มีใคร pin** — field optional ที่เพิ่มไม่ทำให้ payload ใบไหนพัง
และตาม ADR-0006 การเพิ่ม optional field ไม่ใช่ breaking

## คำถามที่ยังไม่มีคำตอบในเอกสารปัจจุบัน

### 1. ใครเป็นคนคำนวณ intersection และคำนวณเมื่อไหร่

`profiles/README.md` ระบุเองว่ากฎเหล่านี้ **schema จับไม่ได้** ต้องใช้คนหรือ lint ภายนอก
และ [ADR-0008](https://github.com/monthop-gmail/agent-platform/blob/main/decisions/0008-reference-stack.md)
ห้ามมี code ใน `agent-platform` — แปลว่ายังไม่มีใครเป็นเจ้าของการบังคับกฎนี้

รีโปเราหักสิทธิ์ที่ **Builder ไม่ใช่ที่ runtime** — tool ที่ถูกห้ามจะไม่เดินทางไปถึง adapter เลย
เหตุผลคือ adapter ใหม่ทุกตัวคือโอกาสใหม่ที่จะลืมเช็ค ถ้ากฎสามฝ่ายถูกคำนวณตอน build เราทำได้ทันที
**แต่ต้องอ่าน `profiles/*.yaml` เป็นข้อมูลเข้า** จึงขอถามว่า:

- ไฟล์ใน `profiles/` เป็น **แหล่งความจริงที่ consumer pin ได้** หรือเป็นแค่ตัวอย่าง
- ถ้า pin ได้ pin ด้วยอะไร — commit SHA เหมือน schema หรือมี version ของตัวเอง

### 2. `policy_profile` เป็น reference แบบ dynamic หรือ resolve ตอน build

คำถามที่สำคัญที่สุดในใบนี้ และเป็นใบเดียวกับคำถามของ Issue A คนละหน้า —
*อะไรที่ freeze ตอน build ได้บ้าง*

```text
policy_profile  (ชื่อ)
      ↓
Platform Policy Registry
      ↓
Resolved Policy   ← ตรงนี้เกิดเมื่อไหร่
      ↓
+ Agent Policy
      ↓
Effective Policy
      ↓
CompiledAgent
      ↓
Runtime
```

| | ผล |
|---|---|
| **dynamic reference** | เพดานเปลี่ยนแล้วมีผลทันทีกับทุก agent ที่ deploy อยู่ · แต่ package ที่ audit ไว้ไม่บอกว่าตอนนั้นถูกจำกัดด้วยอะไร |
| **resolve ตอน build แล้ว freeze** | reproducible และ audit ย้อนได้ · แต่การรัดเพดานให้แน่นขึ้นไม่มีผลกับของเก่าจนกว่าจะ re-compile |

ทางที่เราเอนเอียง — **resolve ตอน compile แล้วบันทึก `policy_profile` พร้อม version ของมัน
ลงใน artifact** เข้ากับ reproducible build และ audit trail ที่เราทำอยู่

แต่ทางนี้มีต้นทุนที่ต้องพูดออกมาให้ตรง: **การรัดเพดานให้แน่นขึ้นจะไม่มีผลย้อนหลัง**
ถ้า platform ต้องการให้ guardrail ใหม่มีผลทันทีกับ agent ที่ deploy ไปแล้ว
ต้องมีอย่างใดอย่างหนึ่ง — runtime ตรวจซ้ำ หรือกลไกบังคับ re-compile
ซึ่ง**เป็นการตัดสินใจของ platform ไม่ใช่ของ consumer**

ถ้าเลือกทาง freeze เราขอทราบด้วยว่า profile version ควร pin ด้วยอะไร —
commit SHA เหมือน schema หรือมีเลขเวอร์ชันของ profile เอง (ต่อจากข้อ 1)

### 3. `autonomy.level` ของเราแมปกับ `authority_map` ยังไง

ของเราเป็นสเกล 0–3 ต่อ agent · ของเขาเป็น `action_risk → authority` ต่อ profile
เราแมปเองได้ (level 2 ≈ `low/medium: auto`) แต่ถ้า platform อยากได้ค่าที่แมปตรง ๆ
บอกได้ เราเปลี่ยนตาม — ข้อนี้ไม่ใช่ contract change ฝั่งเขา

## ตรวจก่อนส่ง

- [x] อ่าน ADR-0006 เรื่องนิยาม breaking change แล้ว
- [x] เช็ค `architecture/consumers.md` — `agent` `profile` ยังไม่มีใคร pin
- [x] ถ้าเป็น breaking change — เข้าใจว่าต้องขึ้น major ใหม่ (ใบนี้ไม่ใช่ breaking)

## อ้างอิงฝั่งเรา

[`docs/agent-platform-alignment.md`](https://github.com/monthop-gmail/agent-builder-dsh-poc/blob/main/docs/agent-platform-alignment.md) ·
[`docs/runtime-adapter.md`](https://github.com/monthop-gmail/agent-builder-dsh-poc/blob/main/docs/runtime-adapter.md) ·
[`docs/contract-stability.md`](https://github.com/monthop-gmail/agent-builder-dsh-poc/blob/main/docs/contract-stability.md)
