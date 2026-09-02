# Architecture

## ห้าชั้น

```text
┌─────────────────────────────────────────────┐
│  Experience          CLI (UI ยังไม่ทำ)       │
├─────────────────────────────────────────────┤
│  Agent Definition    Agent Manifest          │
├─────────────────────────────────────────────┤
│  Builder / Compiler                          │
│  load → validate → resolve → policy →        │
│  compile → package                           │
├─────────────────────────────────────────────┤
│  Runtime Adapter     dsh | mock | future     │
├─────────────────────────────────────────────┤
│  Execution           MCP | Tools | Skills    │
└─────────────────────────────────────────────┘
```

## ทิศทางการพึ่งพา

ชั้นบนรู้จักชั้นล่างเท่านั้น และมีกฎเพิ่มอีกข้อ:

> `builder/**` ห้าม import อะไรจาก `runtimes/**`

ทางเดียวที่ Builder ไปถึง runtime ได้คือผ่าน `builder/registry/runtimes.ts`
ซึ่ง lazy-import ผ่าน `AgentRuntime` interface — เป็นจุด swap จุดเดียวของทั้งระบบ

## ทำไม policy อยู่ในชั้น Builder

ถ้าให้ runtime บังคับ policy เอง แต่ละ adapter ใหม่คือโอกาสใหม่ที่จะลืม และการลืมหนึ่งครั้ง
= policy bypass ที่ไม่มีใครเห็น การหัก forbidden ออกที่ Builder ทำให้เรื่องนี้เป็นไปไม่ได้
โดยโครงสร้าง — runtime ไม่ได้รับ tool นั้นมาตั้งแต่แรก

```text
manifest.tools.allowed  ─┐
                         ├─→ granted = allowed − forbidden ─→ adapter
manifest.policy.forbidden┘
```

## ตำแหน่งใน ecosystem

```text
        agent-platform (L3)            ← ปลายทางของ Manifest contract
               │
               ▼
        Agent Manifest                 ← repo นี้เสนอ
               │
               ▼
        Agent Builder (L4)             ← repo นี้
               │
      ┌────────┴────────┐
      ▼                 ▼
     dsh               pi              ← agent-builder-pi-poc
      │                 │
      └────────┬────────┘
               ▼
        llm-gateway (L2)               ← ทางออก LLM ทางเดียว (B1)
               │
               ▼
     free-llm-registry (L1)            ← เจ้าของรายชื่อ model
```

## จุดที่ยังไม่นิ่ง

- **one-shot vs long-running** — `run(input) → result` วันนี้เป็น one-shot
  P6 (Issue → PR) ต้องการ agent ที่รันเป็นนาที มี progress และหยุดรอคนได้
  ต้องตัดสินก่อนเขียน adapter ตัวที่สาม ไม่งั้นต้องรื้อพร้อมกันหมด
- **`resume()`** — มี interface แล้ว ทั้งสอง adapter ยัง throw รอ P5
- **sub-agent** — schema รับ `spec.subagents` แล้ว ยังไม่ compile
  ต้องตัดสินว่า sub-agent เป็น manifest ของตัวเอง (compose ได้ ทดสอบแยกได้) หรือ inline block
- **effect ของ MCP tool** — ตอนนี้ assume `write` ทั้งหมด เพราะ MCP ไม่บอก
  under-privilege แก้ได้ over-privilege แก้ไม่ได้ ถ้า server บอก metadata ได้ในอนาคตควรอ่านจริง
