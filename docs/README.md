# docs/

เอกสารที่ **ตรวจแล้ว** — ต่างจาก [`../ref/`](../ref/) ที่เก็บสิ่งที่รับมาดิบ ๆ ยังไม่ตัดสินใจ

## contract สี่ตัวของ Agent Builder

รีวิวจากทีมขอ contract ไว้สี่ชิ้น — สามชิ้นมีอยู่แล้วภายใต้ชื่ออื่น จึงลิงก์ไปแทนที่จะเขียนซ้ำ
(`ecosystem-brief` มีกติกาข้อหนึ่งว่า **ลิงก์ > คัดลอก** เพราะสำเนาที่สองคือที่ที่ความจริงเริ่มแตก)

| ที่รีวิวขอ | อยู่ที่ | |
|---|---|---|
| `agent-manifest-v1.md` | [`manifest.md`](manifest.md) | ยังเป็น `v1alpha2` โดยตั้งใจ — เหตุผลอยู่ในไฟล์ |
| `compiled-agent-contract.md` | [`compiled-agent-contract.md`](compiled-agent-contract.md) | ✅ ตัวเดียวที่ขาดจริง เพิ่งเขียน |
| `runtime-contract.md` | [`runtime-adapter.md`](runtime-adapter.md) | interface + กติกาที่ adapter ต้องรักษา |
| `capability-matrix.md` | [`capability-matrix.md`](capability-matrix.md) | **generate จากโค้ด** |

## กติกาความนิ่งของ contract

[`contract-stability.md`](contract-stability.md) — อะไร freeze แล้ว อะไรนับเป็น breaking
และบังคับด้วย `tests/compatibility/` กับ `tests/contract-stability.test.ts`

## ต่อกับ agent-platform

[`../platform-contract.yaml`](../platform-contract.yaml) — consumer manifest ตาม ADR-0006
· pin `capability/v1` `profile/v1` `execution/v1` `identity/v1` · พร้อมเหตุผลว่าทำไม
**ไม่** pin `agent/v1` และ `tool/v1` · บังคับด้วย [`conformance/`](../conformance/)

[`agent-platform-alignment.md`](agent-platform-alignment.md) — contract ของเราเทียบกับ
`agent-platform` (L3) · ชนกันตรงไหน · ใครต้องตัดสิน · ทำไมยังไม่ใส่ `platform-contract.yaml`

[`effective-policy.md`](effective-policy.md) — กฎสามฝ่าย (profile · agent · tenant)
ที่ ADR-0022 บอกว่า **พิสูจน์ได้จากเทสของ consumer เท่านั้น** · แมป field ของเราเข้ากับ
`agent/v1` v1.1.0 · และสองเรื่องที่ยังไม่จบ (identity ยังไม่ครอบ effective policy ·
ศัพท์ของ tool ยังคนละชุด)

## harness ที่ต่อได้

[`harness-integration.md`](harness-integration.md) — harness ตัวไหนเข้าทางไหน
และแต่ละข้อยืนยันถึงไหน (รันจริง / อ่านเอกสารเขา)

## ที่เหลือ

| ไฟล์ | |
|---|---|
| [`architecture.md`](architecture.md) | ภาพรวมว่าชิ้นส่วนต่อกันยังไง |
| [`poc-review-2026-09-02.md`](poc-review-2026-09-02.md) | บันทึกการตรวจ 14 หัวข้อ — อะไรพิสูจน์แล้ว อะไรยัง |
| [`poc-results.md`](poc-results.md) | ผลรันครั้งแรก เก็บไว้ตามวันที่ ไม่อัปเดต |

## เอกสารที่ป้องกันตัวเองได้

สองไฟล์นี้จะทำให้ `npm test` ล้มถ้าเนื้อหาไม่ตรงกับโค้ด:

```
capability-matrix.md         ← npm run docs:capabilities   · capability-matrix.test.ts
compiled-agent-contract.md   ← ตารางฟิลด์                   · compiled-agent-contract.test.ts
contract-stability.md        ← baseline.json                · contract-stability.test.ts
effective-policy.md          ← AGENT_POLICY_FIELD_MAP       · platform-policy.test.ts
```

ที่ทำแบบนี้เพราะ README ของ repo นี้เขียนว่า `npm test ผ่าน 45 test` ค้างมา **9 merge**
ขณะที่ suite วิ่งไป 111 — เอกสารที่ไม่มีอะไรทำให้มันผิดออกมาดัง ๆ จะเก่าเสมอ
