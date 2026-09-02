# Effective policy — กฎสามฝ่าย

`agent-platform` เขียนกฎนี้ไว้ใน `contracts/profile/v1/profile.schema.yaml` เอง:

> profile เป็น "เพดาน" ไม่ใช่ "การอนุญาต" — สิทธิ์จริงคือส่วนที่ profile, agent
> และ policy ของ tenant ตกลงตรงกันทั้งสามฝ่าย **ค่าที่กว้างที่สุดชนะไม่ได้**

[ADR-0022](https://github.com/monthop-gmail/agent-platform/blob/main/decisions/0022-agent-may-narrow-its-own-scope.md)
เขียนวิธีรวมไว้ แล้วบอกตรง ๆ ว่าบังคับด้วย schema ไม่ได้:

> กฎการรวม (intersection/union) และกฎ `required ∩ deny = ∅`
> **พิสูจน์ได้จากเทสของ consumer ที่รันจริงเท่านั้น**

เอกสารนี้อธิบายว่ารีโปนี้บังคับกฎนั้นยังไง — และ
[`tests/platform-policy.test.ts`](../tests/platform-policy.test.ts) คือที่ที่พิสูจน์จริง

## กฎ

```text
allow  →  intersection      profile.tools.allow ∩ agent.tools.allowed
deny   →  union             deny ของฝ่ายใดก็ตามชนะเสมอ
require_human_for → union   ยกระดับผู้ตัดสิน ไม่ใช่การปฏิเสธ

required(agent) ∪ required(profile)  ตัดกับ  deny ทั้งหมด
    → ต้องว่าง · ถ้าไม่ว่าง = binding invalid → reject
```

ข้อสุดท้ายสำคัญที่สุด: **agent ที่ต้องการ `shell` ใต้ profile ที่ปิด `shell`
ไม่ใช่ agent ที่รันแบบจำกัด แต่คือ agent ที่รันไม่ได้** — เราจึง `throw`
ไม่ใช่คืน report ที่ผู้เรียกเลือกจะไม่อ่านก็ได้

## แมป field

manifest ของเราเป็น contract ที่ freeze แล้ว จึงไม่เปลี่ยนชื่อ field
แต่ฉายลงเป็นศัพท์ของ `agent/v1` ที่จุดเดียว (`builder/platform.ts`)

| ของเรา (`agent/v1alpha2`) | ของ platform (`agent/v1` v1.1.0) |
|---|---|
| `spec.policy.forbidden` | `policy.deny_tools` |
| `spec.policy.deniedCapabilities` | `policy.deny_capabilities` |
| `spec.humanApproval.required` | `policy.require_human_for` |
| `spec.tools.allowed` | `tools` |

`spec.policy.deniedCapabilities` เป็น field **ใหม่** เพิ่มแบบ optional จึงไม่ breaking
ตาม [`contract-stability.md`](contract-stability.md) — manifest เดิมทุกใบยัง valid และให้ผลเท่าเดิม

**ไม่มี `allow` ฝั่ง agent และจะต้องไม่มี** — ถ้ามี กฎ "กว้างที่สุดชนะไม่ได้" ตายทันที
เหตุผลเดียวกับที่ platform ใส่ `additionalProperties: false` ไว้ที่บล็อกนั้น

**ไม่อ่าน `authority_map` ของ profile** — การ map `action_risk → authority` เป็นของ tenant
ตาม ADR-0010 ไม่ใช่ของ build

## ใช้ยังไง

```bash
agent-builder build manifests/code-reviewer.yaml --target dsh \
  --profile ./profiles/coding-agent/profile.yaml
```

ไม่ใส่ `--profile` = ไม่มีเพดาน พฤติกรรมเท่าเดิมทุกอย่างกับก่อนมีฟีเจอร์นี้ —
**เราไม่มี profile ปริยาย** เพราะการแอบมีเพดานในตัวเองเท่ากับรีโปนี้คิด policy ของ
platform ขึ้นมาเอง ซึ่งเป็นสิ่งเดียวที่ทุก issue ที่เราเปิดพยายามไม่ทำ

## หักที่ Builder ไม่ใช่ที่ runtime

`CompiledAgent.policy` เก็บ **effective policy** ไม่ใช่ครึ่งของ manifest
tool ที่ถูกห้ามไม่เดินทางไปถึง adapter เลย

จุดที่สำคัญคือ **tool ที่มาทีหลัง** — MCP server ไม่บอก tool ของตัวเองจนกว่าจะ connect
`admitLateTools()` จึงกรองด้วย effective policy เดียวกัน ไม่งั้นเพดานจะมีรูเดียวที่
compile time มองไม่เห็น

## สองเรื่องที่ยังไม่จบ

### 1. identity ยังไม่ครอบ effective policy

ADR-0022 เตือนไว้ว่า:

> ⚠️ ถ้า deny-list ถูก compile ลงไปในสิ่งที่ build แล้ว **มันต้องอยู่ใน identity ของสิ่งนั้นด้วย**

ตอนนี้ยัง**ไม่ใช่** — `manifestChecksum` คำนวณจาก manifest อย่างเดียว build สองครั้ง
ด้วยคนละ profile ได้ checksum เท่ากันแต่ได้ agent คนละตัว

เราบันทึก `policySource: { profileId, profileChecksum }` ไว้แล้วเพื่อให้ตามรอยได้
แต่ **ไม่นับเป็น identity** จนกว่า [`agent-platform#52`](https://github.com/monthop-gmail/agent-platform/issues/52)
จะตอบว่า identity ควรครอบ *ชุดที่อนุญาต* หรือ *ตัวที่ใช้จริง* — คำตอบนั้นกำหนดว่า
จะเป็น checksum เดียวหรือสองเลข มีเทสยืนยันช่องว่างนี้อยู่ ไม่ได้ปล่อยผ่านเงียบ ๆ

### 2. ศัพท์ของ tool ยังคนละชุด

`profiles/coding-agent` พูด `tool/v1` ToolId (`github.pr.merge` · `fs.file.read`)
รีโปนี้พูดชื่อใน Tool Registry ของตัวเอง (`github.merge`) — ภายใต้ intersection
แปลว่าเอา profile จริงมาใช้แล้ว **tool หายหมดทุกตัว**

มีเทสยืนยันพฤติกรรมนี้ตรง ๆ แทนที่จะแก้ fixture ให้ผ่าน เพราะการทำให้เทสเขียว
โดยไม่ได้แก้ของจริงคือการซ่อนงานที่ยังไม่ได้ทำ

น่าสังเกตว่าสิ่งที่**ตรงกัน**คือกฎ ไม่ใช่ชื่อ — profile ของเขา deny การ merge พร้อม
คอมเมนต์ *"merge เป็นของคน ไม่ใช่ของ agent"* และ manifest ตัวอย่างของเราห้ามการกระทำ
เดียวกันใต้ชื่ออื่น เราค้นพบแยกกันแล้วได้ข้อสรุปเดียวกัน

### ยังไม่ตอบ: pin `profiles/` ได้ไหม

เราถามไว้ใน [#47](https://github.com/monthop-gmail/agent-platform/issues/47) ว่าไฟล์ใน
`profiles/` เป็นแหล่งความจริงที่ consumer pin ได้หรือเป็นแค่ตัวอย่าง — **ยังไม่มีคำตอบ**

ระหว่างนี้ `--profile` รับ path ของไฟล์ที่ผู้เรียกส่งมา **เราไม่ได้ pin อะไร**
และไฟล์ใน `tests/fixtures/platform/` เป็น fixture ที่ vendor มาพร้อมเลข commit
ไม่ใช่การประกาศ conformance
