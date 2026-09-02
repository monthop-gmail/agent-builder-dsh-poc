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
