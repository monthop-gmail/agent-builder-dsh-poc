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

## เพดานไม่เคย "ให้"

profile เป็นเพดาน ไม่ใช่การอนุญาต — ถ้า manifest ไม่ขอ tool ใดเลย **agent ก็ไม่ได้ tool ใดเลย**
ไม่ว่า profile จะกว้างแค่ไหน การส่ง `tools.allow` ให้เป็นสิทธิ์เมื่อ manifest เงียบ คือการ
กลับหัวคำว่าเพดาน และจะทำให้ agent ได้ tool ที่ manifest ไม่เคยเอ่ยถึง

## profile ที่มาจากคนละ namespace → reject

[ADR-0026](https://github.com/monthop-gmail/agent-platform/blob/main/decisions/0026-tool-identity-ceiling-is-namespace-bound.md)
ข้อ 3 — `tools.allow` ที่ไม่ตรงกับ tool ที่ agent ขอเลยสักตัว **ไม่ได้แปลว่า "ห้ามทุกอย่าง"
แต่แปลว่าเอา profile ผิด namespace มาใช้** จึงต้อง reject

กฎนี้เกิดจากเทสในรีโปนี้ที่บันทึกไว้ว่า `profiles/coding-agent` ของจริงพูด `tool/v1` ToolId
(`github.pr.merge`) ขณะที่เราพูดชื่อใน registry ตัวเอง (`github.merge`) → tool หายหมด
แล้ว agent ยัง build ได้ · platform รับไปเปิดเป็น [#53](https://github.com/monthop-gmail/agent-platform/issues/53)
และชี้ว่าเรามองด้านที่ปลอดภัยกว่า:

> ด้านที่อันตรายกว่าคือ `deny` ที่ไม่ตรงแล้วเงียบ ทำให้ *"profile นี้ห้าม merge"*
> กลายเป็นความเชื่อที่ไม่จริงโดยไม่มีอะไรบอก

**deny เชิงชื่อปกป้องเฉพาะ namespace ที่มันตั้งชื่อ** (ข้อ 4) — ไม่มีอะไรทำให้
`github.pr.merge` ไปคุ้ม `github.merge` ได้ การ reject จึงเป็นวิธีเดียวที่หยุดคนเข้าใจผิดว่ามันคุ้ม

แยกให้ชัดสามกรณี:

| profile | ผล |
|---|---|
| ไม่มี `tools.allow` | ไม่มีเพดานเชิงชื่อ — เพดานมาจาก capability กับ authority |
| `tools.allow: []` | ห้ามทุก tool **โดยเจตนา** ทำงานปกติ |
| `tools.allow` ไม่ตรงสักตัว | **reject** — ใช้ผิด namespace |

## identity ครอบ effective policy แล้ว

ADR-0022 เตือนว่า deny-list ที่ compile ลงไปในสิ่งที่ build ต้องอยู่ใน identity ของสิ่งนั้น
และ [ADR-0025](https://github.com/monthop-gmail/agent-platform/blob/main/decisions/0025-provider-switch-and-what-identity-covers.md)
(ตอบ [#52](https://github.com/monthop-gmail/agent-platform/issues/52)) ตัดสินว่า identity ครอบ
**ทั้งชุดที่แช่แข็งรวมลำดับ** ไม่ใช่ตัวที่ใช้จริง

`CompiledAgent.buildIdentity` คือเลขนั้น — ครอบ manifest checksum · โซ่ model ทั้งเส้นตามลำดับ ·
effective policy · และ profile ที่ใช้ (id + checksum ของไฟล์)

`manifestChecksum` **ไม่เปลี่ยนความหมาย** ยังตอบว่า *มาจาก source เดียวกันไหม*
สองเลขตอบคนละคำถาม ดู [`compiled-agent-contract.md`](compiled-agent-contract.md)

## เพดานเชิงคุณสมบัติ — ครึ่งที่ข้าม namespace ได้

ADR-0026 ข้อ 4 บอกว่า **deny เชิงชื่อปกป้องเฉพาะ namespace ที่มันตั้งชื่อ** ซึ่งแปลว่า
`profiles/coding-agent` ที่ deny `github.pr.merge` **ไม่มีทาง**คุ้ม `github.merge` ของเรา —
และนั่นไม่ใช่บั๊กที่แก้ได้ แต่เป็นข้อจำกัดตามนิยาม

capability ข้ามเส้นนั้นได้ เพราะทุก registry พูดคำเดียวกัน 14 คำ

`ResolvedTool` ทุกตัวจึงประกาศ `capabilities` ว่ามัน**รันอยู่บนอะไร** — คนละเรื่องกับ
`effect` ที่บอกว่าเรียกแล้วเสียหายได้แค่ไหน:

| tool | capabilities | ทำไม |
|---|---|---|
| `calculator` | *(ว่าง)* | ไม่ได้ออกนอก process · **ไม่ใช่ `code_execution`** เพราะนั่นแปลว่ารันโค้ดที่รับมาบน host |
| `current_time` | *(ว่าง)* | |
| `web_search` | `network_egress` | ยิงออก api.duckduckgo.com |
| `github.*` | `github` · `network_egress` | tool-scope กับ host-scope คนละอัน (ADR-0009) ต้องมีทั้งคู่ |
| tool จาก MCP | `mcp` | ประกาศตอน connect — เป็นเคสที่เพดานเชิงชื่อคุ้มไม่ได้เลย |

`deny_capabilities` ของฝ่ายใดก็ตามตัดกับ `capabilities` ของ tool = **tool นั้นใช้ไม่ได้**
(ADR-0026 ข้อ 2) รายงานแยกจาก `droppedByPolicy` เพราะเป็นคนละข้อเท็จจริง —
*"มีคนเอ่ยชื่อ tool นี้"* กับ *"tool นี้ต้องใช้สิ่งที่ห้ามไว้"* และมีแค่อย่างหลังที่เดินทางข้ามบ้านได้

**เพดานเชิงชื่อเทียบกันใน ToolId space** — profile พูด `tool/v1` `ToolId` เสมอ เพราะมันมาจาก
platform ที่ไม่เคยรู้จักชื่อภายในของ registry นี้ · Builder จึงแปลงชื่อภายในเป็น wire id
ก่อนเทียบ แล้วแปลงกลับเป็นชื่อภายในตอนส่งให้ registry (`builder/tool-ids.ts` · #59 option A)

ผลคือ profile ที่เขียน `time.now` คุม `current_time` ของเราได้ — ซึ่งเทียบสตริงตรง ๆ ทำไม่ได้

**ที่ยังทำไม่ได้และไม่ควรพยายาม:** profile ที่ allow `github.issue.read` ยังใช้กับ registry ที่มี
`github.read` ไม่ได้ — **คนละ tool ไม่ใช่ tool เดียวกันสะกดต่างกัน** mapping กลบตรงนั้นไม่ได้
และไม่ควรกลบ · reject ตามข้อ 3 นั่นถูกแล้ว

**`capability_requirement` ฝั่ง manifest** — ✅ ทำแล้ว `spec.capabilities.required`
เข้าไปอยู่ในกฎ `required ∩ deny` แล้ว ทั้งสองฝ่ายจึงอยู่ใน union จริงตามที่ ADR-0022 เขียน
· และใช้เลือก model แล้ว — `required` กรอง `model.preferred`, `preferred` จัดอันดับ
ดู [`manifest.md`](manifest.md)

### ยังไม่ตอบ: pin `profiles/` ได้ไหม

เราถามไว้ใน [#47](https://github.com/monthop-gmail/agent-platform/issues/47) ว่าไฟล์ใน
`profiles/` เป็นแหล่งความจริงที่ consumer pin ได้หรือเป็นแค่ตัวอย่าง — **ยังไม่มีคำตอบ**

ระหว่างนี้ `--profile` รับ path ของไฟล์ที่ผู้เรียกส่งมา **เราไม่ได้ pin อะไร**
และไฟล์ใน `tests/fixtures/platform/` เป็น fixture ที่ vendor มาพร้อมเลข commit
ไม่ใช่การประกาศ conformance
