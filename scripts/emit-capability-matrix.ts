import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { getRuntime, listRuntimeIds } from "../builder/registry/runtimes.js";
import { classifyGaps, listGapNames } from "../builder/registry/capabilities.js";

/**
 * Generate docs/capability-matrix.md from the code.
 *
 * The matrix is exactly the kind of document that rots: it is a table of
 * facts that live in five adapters, and nothing makes it wrong out loud when
 * one of them changes. This repo already shipped a README claiming 45 tests
 * while the suite ran 111, through nine merges, so the matrix is derived
 * rather than written and a test fails when the file drifts.
 *
 * `unsupported()` is a pure function of a CompiledAgent, so asking every
 * adapter needs no credentials, no network and no running agent.
 */

const PROBE = resolve(import.meta.dirname, "../tests/fixtures/capability-probe.yaml");
const OUTPUT = resolve(import.meta.dirname, "../docs/capability-matrix.md");

export async function renderCapabilityMatrix(): Promise<string> {
  const loaded = await loadManifest(PROBE);
  const result = validateManifest(loaded.value);
  if (!result.ok) throw new Error(`capability probe is invalid: ${result.errors.join("; ")}`);
  const agent = compileManifest(loaded.value as AgentManifest, loaded.checksum).agent;

  const runtimes = listRuntimeIds();
  const reported = new Map<string, Set<string>>();
  for (const id of runtimes) {
    const runtime = await getRuntime(id);
    reported.set(id, new Set(runtime.unsupported(agent)));
  }

  const gaps = listGapNames();
  const severity = new Map(
    gaps.map((name) => {
      const report = classifyGaps([name]);
      return [name, report.blocking.length ? "⛔ blocks" : "⚠ degrades"] as const;
    }),
  );
  const meaning = new Map(
    gaps.map((name) => {
      const report = classifyGaps([name]);
      return [name, (report.blocking[0] ?? report.degrading[0])?.meaning ?? ""] as const;
    }),
  );

  const header = `| capability | ถ้าทำไม่ได้ | ${runtimes.join(" | ")} |`;
  const divider = `|---|---|${runtimes.map(() => "---|").join("")}`;
  const rows = gaps.map((name) => {
    const cells = runtimes.map((id) => (reported.get(id)?.has(name) ? "❌" : "✅"));
    return `| \`${name}\` | ${severity.get(name)} | ${cells.join(" | ")} |`;
  });

  const notes = gaps.map((name) => `- \`${name}\` — ${meaning.get(name)}`);

  return [
    "# Capability Matrix",
    "",
    "> **สร้างจากโค้ด อย่าแก้ด้วยมือ** — `npm run docs:capabilities`",
    "> `capability-matrix.test.ts` จะล้มถ้าไฟล์นี้ไม่ตรงกับสิ่งที่ adapter รายงานจริง",
    "",
    "ตารางนี้ตอบคำถามเดียว: **ถ้า manifest ขอสิ่งนี้ target ไหน honour ได้บ้าง**",
    "",
    "ทุกช่องมาจากการเรียก `unsupported()` ของ adapter จริงด้วย manifest ตัวเดียว",
    `([\`tests/fixtures/capability-probe.yaml\`](../tests/fixtures/capability-probe.yaml))`,
    "ที่ขอทุกอย่างพร้อมกัน — ✅ คือ honour ได้ ❌ คือ adapter ประกาศเองว่าทำไม่ได้",
    "",
    header,
    divider,
    ...rows,
    "",
    "## ช่องว่างแต่ละอันแปลว่าอะไร",
    "",
    ...notes,
    "",
    "## ⛔ กับ ⚠ ต่างกันอย่างไร",
    "",
    "> ช่องว่างที่ทำให้**ข้อจำกัด**หายไป → ปฏิเสธไม่ให้รัน",
    "> ช่องว่างที่ทำให้**ความสามารถ**หายไป → เตือนแล้วรันต่อ",
    "",
    "กติกาเต็มอยู่ใน [`runtime-adapter.md`](runtime-adapter.md) และ",
    "[`poc-review-2026-09-02.md` §13](poc-review-2026-09-02.md)",
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const markdown = await renderCapabilityMatrix();
  await writeFile(OUTPUT, markdown, "utf8");
  process.stdout.write(`wrote ${OUTPUT}\n`);
}
