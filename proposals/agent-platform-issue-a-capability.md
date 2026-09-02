# ร่าง Issue A → `agent-platform`

**หัวข้อ:** `agent/v1` ควรประกาศ *capability ที่ต้องการ* หรือ *model/provider* — และใครเป็นคน resolve binding

**ประเภท:** contract-change (ใช้ template `contract-change.yml`)
**contract ที่เกี่ยว:** `agent/v1` · `capability/v1` · `model/v1` · `provider/v1`
**สถานะ:** 📝 ร่าง ยังไม่เปิด

---

## บริบท

[`agent-builder-dsh-poc`](https://github.com/monthop-gmail/agent-builder-dsh-poc) กำลังจะ
consume `agent/v1` และเจอว่า manifest ของเรากับ contract ของที่นี่ตอบคำถามเดียวกันคนละแบบ

`contracts/agent/v1/agent.schema.yaml` มี `capability_requirement` พร้อมคำอธิบายอ้าง ADR-0009:

> agent บอกว่าต้องการอะไร ไม่ใช่ระบุ provider
> ถ้าจำเป็นต้อง pin provider จริง ให้ใช้ `constraints.pin_provider` และเขียนเหตุผลกำกับ

ส่วน manifest ของเรา (`agent/v1alpha2`) ระบุ provider ตรง ๆ:

```yaml
spec:
  model:
    preferred: [deepseek, glm]     # เรียงตามลำดับความชอบ = fallback chain ด้วย
```

## คำถามที่อยากให้ตัดสิน

**ไม่ใช่** "จะใช้ของใคร" แต่คือ:

> **agent contract ต้องบอก "capability ที่ต้องการ" หรือ "model/provider ที่ต้องการ"
> และใครเป็นผู้ resolve binding**

## สิ่งที่เรามีอยู่แล้ว ซึ่งอาจเป็นครึ่งหนึ่งของคำตอบ

รีโปเรามีชั้น resolve คั่นอยู่แล้ว — manifest ไม่ได้ถึงมือ runtime ตรง ๆ

```text
manifest: model.preferred [deepseek, glm]
      ↓
Model Registry            ← catalog มาจาก free-llm-registry เมื่อตั้ง FREE_LLM_REGISTRY_URL
      ↓                     ไม่ใช่ hardcode ในโค้ด
ModelBinding: { id, baseUrl, apiKeyEnv, route: gateway|direct }
      ↓
CompiledAgent → runtime
```

แปลว่า **จุดที่ resolve มีอยู่แล้ว** สิ่งที่ยังไม่ตรงกับ ADR-0009 คือ *ภาษาที่ manifest ใช้พูด*
— ยังพูดเป็นชื่อ provider ไม่ใช่ capability

## ทางเลือก

### A1 — manifest พูด capability, platform/registry เป็นคน resolve ⭐

```text
Manifest
  ↓  capability requirement
Platform / Model Registry
  ↓  resolved model
CompiledAgent
```

- ✅ ตรงกับ ADR-0009
- ✅ portability ไม่ผูกกับ provider — ซึ่งเป็นเป้าหมายเดียวกับที่รีโปเราพยายามพิสูจน์อยู่
  (manifest ใบเดียว build ลง 5 runtime ได้ package เท่ากันทุกไบต์)
- ⚠️ ต้องนิยามว่า capability ของ model คืออะไรบ้าง — `tool_calling` · `vision` ·
  context window ขั้นต่ำ · reasoning effort? ตอนนี้ `capability/v1` เขียนไว้แค่ไหน
- ⚠️ **fallback chain จะแสดงยังไง** — `model.preferred` ของเราเป็นลำดับความชอบ *และ*
  เป็น fallback chain ด้วย (เมื่อ endpoint แรกตอบ 429/5xx ซ้ำ ๆ ระบบจะไล่ไปตัวถัดไป)
  ถ้า manifest พูด capability อย่างเดียว **ใครเป็นคนตัดสินลำดับ fallback**

### A2 — ถือว่า `model.preferred` คือ `constraints.pin_provider` ที่มีเหตุผลกำกับ

- ✅ ไม่ต้องแก้ manifest ที่มีอยู่
- ❌ ทำให้ **ทุก** manifest กลายเป็น pinned provider ซึ่งน่าจะผิดเจตนาของ ADR-0009
  ที่ตั้งใจให้ pin เป็นข้อยกเว้นที่ต้องมีเหตุผล ไม่ใช่ค่าปกติ

### A3 — รับทั้งสอง: `capability_requirement` เป็นหลัก `pin_provider` เป็นข้อยกเว้น

- ✅ additive ต่อ contract ของที่นี่ และ additive ต่อ manifest ของเรา
  (ไม่ breaking ตามเกณฑ์ที่รีโปเราใช้อยู่ — เพิ่ม optional field ไม่ถือว่า breaking)
- ⚠️ ต้องมีกฎว่าถ้าใส่ทั้งคู่ อะไรชนะ

## สิ่งที่เราจะทำตามผลแต่ละทาง

| ผล | รีโปเราทำอะไร |
|---|---|
| A1 | เพิ่ม `capability` เข้า manifest · Model Registry resolve จาก capability · ต้องหาที่อยู่ใหม่ให้ fallback ordering |
| A2 | ไม่แก้ manifest · เขียนเอกสารว่า `model.preferred` = pinned provider โดยเจตนา |
| A3 | เพิ่ม `capability` แบบ optional · `model.preferred` ยังใช้ได้ในฐานะ pin |

## หมายเหตุที่อยากให้พิจารณาก่อนตอบ

ตาม `architecture/consumers.md` ตอนนี้ **`agent` `provider` `model` `tool` `mcp` ยังไม่มี
consumer รายไหน pin เลย** — คำตอบของ issue นี้จะกลายเป็น precedent ของ contract ทั้งกลุ่ม
ไม่ใช่แค่ของรีโปเรา เราจึงไม่อยากตัดสินเองแล้วค่อยมาขออนุมัติทีหลัง

## อ้างอิง

- การเทียบ field ทั้งหมด: [`docs/agent-platform-alignment.md`](https://github.com/monthop-gmail/agent-builder-dsh-poc/blob/main/docs/agent-platform-alignment.md)
- contract ฝั่งเรา: [`docs/manifest.md`](https://github.com/monthop-gmail/agent-builder-dsh-poc/blob/main/docs/manifest.md) · [`docs/compiled-agent-contract.md`](https://github.com/monthop-gmail/agent-builder-dsh-poc/blob/main/docs/compiled-agent-contract.md)
