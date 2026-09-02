# ร่าง Issue B → `agent-platform`

**หัวข้อ:** policy authority อยู่ที่ไหน — `policy_profile` ของ platform, policy ใน manifest ของ agent, หรือทั้งคู่

**ประเภท:** contract-change (ใช้ template `contract-change.yml`)
**contract ที่เกี่ยว:** `agent/v1` · `policy/v1` · `profiles/`
**สถานะ:** 📝 ร่าง ยังไม่เปิด

---

## บริบท

`contracts/agent/v1` มี `policy_profile` — อ้าง **ชื่อ** ชุด policy ที่นิยามไว้ใน `profiles/`

ส่วน [`agent-builder-dsh-poc`](https://github.com/monthop-gmail/agent-builder-dsh-poc)
เขียนกฎลงใน manifest ตรง ๆ:

```yaml
spec:
  autonomy:
    level: 2                      # effect ไหนที่ agent ทำเองได้
  policy:
    forbidden: [github.merge]     # Builder หักออกก่อนถึง runtime
  humanApproval:
    required: [github.comment]    # ต้องมีคนกดทุกครั้ง
```

**คำถามนี้ไม่ใช่เรื่อง syntax แต่เป็นเรื่อง authority**

## คำถามที่อยากให้ตัดสิน

> ถ้าทั้ง platform และ agent ต่างมี policy — **อะไรคือ effective policy และใครบังคับ**

## สิ่งที่เราไม่อยากให้เกิด

policy สองชุดที่ต่างคนต่าง enforce แล้วขัดกันเงียบ ๆ — ซึ่งเป็นอาการเดียวกับที่
ADR-0006 ตั้งใจกันตั้งแต่ต้น

## ข้อเสนอ

```text
Platform policy   = fleet / tenant-level guardrail
Agent policy      = agent-level restriction
Effective policy  = ผลที่เข้มกว่า (intersection / most restrictive)
```

ตัวอย่าง:

```text
platform.forbidden = [shell]
agent.forbidden    = [network]

effective.forbidden = [shell, network]
```

**คุณสมบัติที่สำคัญที่สุดของข้อเสนอนี้: agent ไม่มีทาง override ข้อจำกัดของ platform ได้**
manifest เพิ่มข้อจำกัดได้อย่างเดียว ผ่อนไม่ได้

## ทำไมเราคิดว่าข้อนี้สำคัญกว่าเรื่อง field

รีโปเราบังคับ policy ที่ **Builder ไม่ใช่ที่ runtime** — tool ที่ถูกห้ามจะไม่เดินทางไปถึง
adapter เลย ไม่ใช่ไปถึงแล้วห้ามเรียก เหตุผลคือ adapter ใหม่ทุกตัวคือโอกาสใหม่ที่จะลืมเช็ค

ถ้า effective policy เป็น "เข้มกว่าชนะ" หลักนี้ยังใช้ได้ — Builder รับ platform policy
มารวมกับ agent policy แล้วหักสิทธิ์ครั้งเดียวก่อน compile เสร็จ

แต่ถ้า **platform เป็นเจ้าของ policy ทั้งหมด** (agent ไม่มี policy ของตัวเอง) รีโปเราจะต้อง
เปลี่ยนโครงพอสมควร และ manifest จะอ่านแล้วไม่รู้ว่าตัวเองถูกจำกัดอะไร ต้องไปเปิด profile ดู

## ทางเลือก

| | effective policy | ผลกับ manifest |
|---|---|---|
| **B1 — เข้มกว่าชนะ** ⭐ | `platform ∪ agent` (forbidden รวมกัน) | manifest ยังเขียน policy ได้ แต่เพิ่มข้อจำกัดได้อย่างเดียว |
| B2 — platform เป็นเจ้าของทั้งหมด | platform เท่านั้น | manifest เลิกมี `policy` · อ้าง `policy_profile` แทน |
| B3 — agent override ได้ | agent ชนะ | ❌ **ไม่เสนอ** — agent ผ่อนข้อจำกัดของ tenant ได้ = guardrail ไม่มีความหมาย |

## สิ่งที่ต้องนิยามเพิ่มถ้าเลือก B1

- `humanApproval` รวมกันยังไง — union เหมือน forbidden ใช่ไหม
- `autonomy.level` ของ agent เทียบกับ guardrail ของ platform — **ต่ำกว่าชนะ** ใช่ไหม
- ถ้า platform เปลี่ยน guardrail แล้ว agent ที่ compile ไปแล้วเป็นยังไง —
  ต้อง re-compile หรือ runtime ตรวจซ้ำ (เกี่ยวกับ `manifestChecksum` ที่เราใช้มัด
  ผลลัพธ์กลับไปหา manifest)

## สิ่งที่เราจะทำตามผลแต่ละทาง

| ผล | รีโปเราทำอะไร |
|---|---|
| B1 | Builder รับ platform policy เข้ามารวมก่อนหัก — เปลี่ยนไม่มาก เพราะจุดหักมีอยู่แล้วที่เดียว |
| B2 | ถอด `policy.forbidden` / `humanApproval` ออกจาก manifest → **breaking change** ของ `agent/v1alpha2` ต้อง bump version |

## อ้างอิง

- การเทียบ field ทั้งหมด: [`docs/agent-platform-alignment.md`](https://github.com/monthop-gmail/agent-builder-dsh-poc/blob/main/docs/agent-platform-alignment.md)
- ทำไมเราหักที่ Builder: [`docs/runtime-adapter.md`](https://github.com/monthop-gmail/agent-builder-dsh-poc/blob/main/docs/runtime-adapter.md)
- กติกา breaking ของเรา: [`docs/contract-stability.md`](https://github.com/monthop-gmail/agent-builder-dsh-poc/blob/main/docs/contract-stability.md)
