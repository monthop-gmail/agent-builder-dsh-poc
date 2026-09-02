# proposals/

**ร่างที่จะส่งออกไป repo อื่น — ยังไม่ได้ส่ง**

ต่างจากอีกสองโฟลเดอร์:

| | ทิศทาง | สถานะ |
|---|---|---|
| [`../ref/`](../ref/) | **เข้า** — สิ่งที่คนอื่นส่งมา | ดิบ ไม่ตัดสิน |
| [`../docs/`](../docs/) | **ในบ้าน** — สิ่งที่ตรวจแล้ว | ผูกพัน |
| `proposals/` | **ออก** — สิ่งที่เราจะถามคนอื่น | ยังไม่ส่ง รอ review |

ที่แยกออกมาเพราะ **ร่างที่ยังไม่ได้ส่ง กับสิ่งที่ส่งไปแล้ว เป็นคนละสถานะ** — ถ้าปนกัน
คนอ่านจะแยกไม่ออกว่าอันไหนเป็นคำถามที่รอคำตอบอยู่ อันไหนคือข้อตกลงแล้ว

เมื่อส่งจริงแล้ว ให้เติมลิงก์ของ issue ไว้ในไฟล์ และย้ายผลการตัดสินไปที่ `docs/`

**ทั้งสองใบเปิดแล้วเมื่อ 2026-09-02** — ไฟล์ในโฟลเดอร์นี้คือสิ่งที่ส่งไปตามตัวอักษร ห้ามแก้ให้ตรงกับคำตอบที่ได้ทีหลัง ให้เขียนผลลง `docs/` แทน

| ร่าง | ปลายทาง | สถานะ |
|---|---|---|
| [`agent-platform-issue-a-capability.md`](agent-platform-issue-a-capability.md) | [`agent-platform#46`](https://github.com/monthop-gmail/agent-platform/issues/46) | ✅ เปิดแล้ว · รอ decision |
| [`agent-platform-issue-b-policy-authority.md`](agent-platform-issue-b-policy-authority.md) | [`agent-platform#47`](https://github.com/monthop-gmail/agent-platform/issues/47) | ✅ เปิดแล้ว · รอ decision |

## ตรวจกับของจริงแล้ว

ร่างทั้งสองใบเขียนใหม่เมื่อ 2026-09-02 หลัง clone `agent-platform` มาอ่านทั้งรีโป —
21 ADR · 16 contract · 6 profile · `architecture/consumers.md` · issue template

สิ่งที่การอ่านเปลี่ยน: คำถามครึ่งหนึ่งในร่างแรก **มีคำตอบอยู่แล้ว** ในรีโปนั้น
การถามซ้ำจะทำให้ใบที่ส่งไปดูเหมือนไม่ได้อ่าน และผิดกติกาใน
`.github/ISSUE_TEMPLATE/config.yml` ที่ระบุว่าเรื่องที่มี ADR อยู่แล้วให้ comment ที่ ADR นั้น


## หลังเปิดแล้ว

| ใบ | ปลายทาง | คำถามหลัก |
|---|---|---|
| A | [`agent-platform#46`](https://github.com/monthop-gmail/agent-platform/issues/46) | `model/v1` บอกว่าเลือก model ตอน runtime เท่านั้น แต่ `CompiledAgent` freeze binding ตอน build — ถูกต้องไหม และผล resolve ต้อง pin/version ไหม |
| B | [`agent-platform#47`](https://github.com/monthop-gmail/agent-platform/issues/47) | กฎ "สามฝ่ายตกลงตรงกัน" ให้ฝ่าย agent มีแต่ `tools` (ที่แปลว่า *ขอ*) กับ `policy_profile` (แค่ชื่อ) — ขอ field ที่ตัดออกได้อย่างเดียว |

ทั้งสองใบ comment cross-link กันไว้แล้ว เพราะเป็นคำถามเดียวกันคนละหน้า —
**อะไรที่ freeze ตอน build ได้บ้าง**
