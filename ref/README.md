# ref/

เอกสารอ้างอิงดิบ — สิ่งที่รับมาจากข้างนอกตามตัวอักษร: รีวิวจากทีม บันทึกการคุย ข้อเสนอที่ยังไม่ได้ตัดสินใจ
ไม่เรียบเรียง ไม่สรุป ไม่แก้ให้ตรงกับ implementation

แยกจาก `docs/` ตรงที่:

| | |
|---|---|
| `ref/` | **สิ่งที่มีคนพูด** — ยังไม่ตรวจ ยังไม่ตัดสินใจ |
| `docs/` | **สิ่งที่ตรวจแล้ว** — พร้อมหลักฐานว่าจริงหรือไม่จริง |

ถ้าข้อเสนอใน `ref/` ถูกตรวจและตัดสินใจแล้ว ให้เขียนผลลงใน `docs/` แล้วลิงก์กลับมาที่นี่
**อย่าแก้ไฟล์ใน `ref/` ให้ตรงกับสิ่งที่เกิดขึ้นทีหลัง** — คุณค่าของมันคือบันทึกว่าตอนนั้นคิดอะไร

| ไฟล์ | |
|---|---|
| [`2026-09-02-pi-vs-dsh-consolidation-review.md`](2026-09-02-pi-vs-dsh-consolidation-review.md) | รีวิวรอบ 1: ให้ DSH เป็น canonical, freeze contract, ทำ conformance vectors กลาง |
| [`2026-09-02-review-02-approve-and-contract-freeze.md`](2026-09-02-review-02-approve-and-contract-freeze.md) | รีวิวรอบ 2: 🟢 APPROVE · ให้เข้า P1 Contract Freeze · อย่าเพิ่ง rename repo / multi-agent / ย้ายเข้า agent-platform |
| [`2026-09-02-review-03-contract-freeze-decisions.md`](2026-09-02-review-03-contract-freeze-decisions.md) | รอบ 3: คำตัดสิน 7 ข้อ — freeze ที่ `v1alpha2` · behavioral compatibility · golden fixtures → ทำตามแล้วใน [`docs/contract-stability.md`](../docs/contract-stability.md) |
| [`2026-09-02-review-04-open-issues-before-pinning.md`](2026-09-02-review-04-open-issues-before-pinning.md) | รอบ 4: merge #25 ได้ · ให้เปิด issue ที่ `agent-platform` 2 ใบ (capability binding · policy authority) โดยร่างมาให้ตรวจก่อน · ยังไม่ต้องทำ `platform-contract.yaml` → ร่างอยู่ที่ [`proposals/`](../proposals/) |
| [`2026-09-02-review-05-issue-drafts-checkup.md`](2026-09-02-review-05-issue-drafts-checkup.md) | รอบ 5: ร่าง issue 🟢 พร้อม · ให้เติม 2 คำถาม (authority ของ resolved `ModelBinding` + `policy_profile` resolve เมื่อไหร่) ก่อนเปิด — เติมแล้ว แต่ร่างถูกเขียนใหม่หลังอ่าน `agent-platform` จริง |
