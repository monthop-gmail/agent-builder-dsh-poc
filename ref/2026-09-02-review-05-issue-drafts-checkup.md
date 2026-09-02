# รีวิวรอบ 5 — ตรวจร่าง issue: พร้อมแล้ว แต่เติมอีก 2 คำถามก่อนเปิด

**วันที่:** 2026-09-02
**บริบท:** ตรวจ `proposals/` ฉบับแรกบน `main` (PR #26)

> บันทึกตามตัวอักษร — ดูกฎใน [`README.md`](README.md)

**สิ่งที่เกิดขึ้นตามมา**
- เติมคำถามทั้งสองข้อแล้ว — Issue A "คำถามที่ 2" · Issue B ข้อ 2
- **แต่ร่างถูกเขียนใหม่ทั้งสองใบ** หลังอ่าน `agent-platform` จริง: ทางเลือก A1/A2/A3 และ B1/B2/B3
  ที่รีวิวนี้อ้างถึงถูกถอดออก เพราะ [ADR-0009](https://github.com/monthop-gmail/agent-platform/blob/main/decisions/0009-capability-model.md)
  ตัดสิน A ไปแล้ว (Accepted) และ `contracts/profile/v1/profile.schema.yaml` เขียนกฎของ B1
  ไว้แล้วตามตัวอักษร — รายละเอียดใน PR ที่แก้ร่าง
- ยังไม่เปิด issue · ยังไม่ทำ `platform-contract.yaml`

---

ทีมแจ้งมาหลังตรวจต้า ... ตรวจให้แล้วจร้า 👍 ผมดู **proposals ทั้ง Issue A และ B** บน `main` แล้ว ภาพรวมถือว่า **พร้อมสำหรับส่งให้ทีม `agent-platform` review** แต่มีจุดเล็ก ๆ ที่ผมอยากปรับก่อนเปิดจริง

### 🟢 Issue A — Capability / Model

ร่างนี้ดีมาก และผมเห็นด้วยกับทิศทาง **A1/A3 มากกว่า A2**

จุดที่ดี:

* ตั้งคำถามถูกระดับ — เป็นเรื่อง **contract semantics + authority** ไม่ใช่ implementation
* ชี้ `model.preferred` ที่ปัจจุบันทำหน้าที่ทั้ง **preference + fallback chain** ได้ดี
* ถามเรื่อง fallback ordering ซึ่ง **ควรถาม** เพราะถ้าเปลี่ยนเป็น capability แล้วเรื่องนี้จะหายไปจาก manifest
* ไม่รีบแก้ schema ก่อนเจ้าของ `agent-platform` ตัดสิน

**ข้อเสนอของผม:** ให้ทีมคงคำถาม fallback ordering ไว้ครับ เพราะนี่เป็นส่วนหนึ่งของ contract ไม่ใช่รายละเอียด implementation

แต่ผมอยากเพิ่มคำถามอีก 1 ข้อ:

> **เมื่อ capability requirement ถูก resolve แล้ว ใครเป็น authority สำหรับ resolved `ModelBinding` และผลการ resolve ต้องถูก pin/version เพื่อให้ `CompiledAgent` reproducible หรือไม่?**

เพราะเรามี `manifestChecksum` อยู่แล้ว ถ้า Model Registry เปลี่ยนผล resolve โดยที่ manifest ไม่เปลี่ยน จะเกิดคำถามเรื่อง reproducibility ทันที

---

### 🟢 Issue B — Policy Authority

อันนี้ผมชอบมากกว่า A อีกครับ เพราะ proposal ระบุ **authority boundary** ชัดเจน

ข้อเสนอ:

```text
Platform Policy
      ↓
Agent Policy
      ↓
Effective Policy
      ↓
CompiledAgent
      ↓
Runtime
```

และหลัก

```text
Platform ห้าม X
Agent ห้าม Y

Effective = X ∪ Y
```

ถูกทิศทางมาก

**B3 ไม่ควรเป็นทางเลือกที่เราพยายามผลักดัน** แต่การใส่ไว้แล้วระบุว่า rejected ก็โอเค เพราะแสดงว่า governance ได้พิจารณาแล้ว

### จุดเดียวที่ผมอยากให้เพิ่ม

เรื่อง **policy_profile ต้อง resolve เมื่อไหร่**

เช่น:

```text
policy_profile
      ↓
Platform Policy Registry
      ↓
Resolved Policy
      ↓
Agent Policy
      ↓
Effective Policy
      ↓
CompiledAgent
```

ควรถามให้ชัดว่า `policy_profile` เป็น

* reference แบบ dynamic
* หรือ resolve ตอน build แล้วกลายเป็น immutable input ของ `CompiledAgent`

ผมเอนเอียงไปทาง **resolve ตอน compile + บันทึก policy/profile version ใน artifact** มากกว่า เพราะเข้ากับแนวคิด reproducible build และ audit ของเราดี

---

## 🎯 สรุป Checkup

| Proposal                 | สถานะ     | ความเห็น                                                       |
| ------------------------ | --------- | -------------------------------------------------------------- |
| **A Capability**         | 🟢 พร้อม  | คง fallback question + เพิ่ม binding authority/reproducibility |
| **B Policy**             | 🟢 พร้อม  | เพิ่มเรื่อง profile resolution/version                         |
| เปิด issue ตอนนี้        | 🟡        | ผมแนะนำแก้ 2 จุดข้างบนก่อน                                     |
| แก้ Manifest             | 🔴 ยังไม่ | รอ platform decision                                           |
| `platform-contract.yaml` | 🔴 ยังไม่ | ถูกต้องแล้วที่ยังไม่ทำ                                         |

ดังนั้นผมจะบอกทีมว่า **“ยังไม่ต้องเปิด issue วันนี้ ให้เก็บ proposal ไว้ แล้วเติมคำถาม 2 จุดนี้ก่อน”**

จากนั้นค่อยเปิด A+B พร้อมกันที่ [agent-platform](https://github.com/monthop-gmail/agent-platform)

นี่เป็นจังหวะที่ดีมาก เพราะเราไม่ได้แค่เอา Agent Builder ไปเชื่อม platform แต่กำลังช่วยวาง **contract boundary ของ ecosystem ทั้งชุด** ตั้งแต่รายแรกเลยครับ 🚀
