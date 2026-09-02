# spike: ขับ DeepSeek Harness ตัวจริงผ่าน ACP

ผลและข้อสรุปอยู่ที่ [`../../docs/poc-review-2026-09-02.md#9-ผล-spike`](../../docs/poc-review-2026-09-02.md)
โค้ดในโฟลเดอร์นี้เป็น **spike ไม่ใช่ของ production** ไม่มี test ไม่ผูกกับ builder

## รัน

```bash
mkdir dsh-spike && cd dsh-spike && npm init -y
pnpm add @deepseek-ai/dsh@0.1.2-alpha.4        # ต้อง pnpm — npm OOM
export DSH_HOME=$PWD/.dsh-home
dsh plugin --profile acp add @deepseek-ai/dsh-acp-app@0.1.2-alpha.4   # เวอร์ชันต้องตรงกัน

cp <this dir>/* .
export OPENCODE_ZEN_API_KEY=sk-...
export AI_COLLAB_MCP_URL=https://... AI_COLLAB_MCP_TOKEN=...
export DSH_PERMISSION_MODE=read-only

node acp-spike.mjs ./node_modules/.bin/dsh --profile acp --patch ./zen.cordis.patch.yml
```

`SPIKE_PROMPT` เปลี่ยน prompt ได้ · client ตอบ `session/request_permission` เป็น `allow_once`
อัตโนมัติเสมอ — ซึ่งเป็นตัวที่พิสูจน์ว่า sandbox ถูกปลดได้ด้วย client (ดูข้อ 9.5)

| ไฟล์ | ใช้กับ |
|---|---|
| `zen.cordis.patch.yml` | profile `acp` |
| `zen-headless.cordis.patch.yml` | profile `headless` |
| `zen-mcp.cordis.patch.yml` | profile `headless` + ต่อ MCP collaboration |

token ใน `.yml` ถูกแทนด้วย `${AI_COLLAB_MCP_TOKEN}` — DSH ไม่ขยาย env ในไฟล์ patch
ให้ใส่ค่าจริงลงไฟล์ในเครื่อง (อย่า commit) หรือใช้ `!!js process.env.AI_COLLAB_MCP_TOKEN`
