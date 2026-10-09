// Workers compatibility probe: drives the public SDK inside workerd against a stubbed provider
// (`globalThis.fetch`) and reports, per capability, whether it works. See wrangler.toml for how to run it.
import { createCodingAgent } from "../../src/sdk";
import * as fs from "node:fs/promises";

const enc = new TextEncoder();
function sseResponse(chunks: unknown[]) {
  const body = chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join("");
  return new Response(enc.encode(body), { headers: { "content-type": "text/event-stream" } });
}
const chunk = (delta: any, finish: string | null = null) => ({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });
const usage = { id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
let script: any[] = [];
let calls = 0;
globalThis.fetch = (async (_url: any, init: any) => {
  const reply = script[Math.min(calls++, script.length - 1)];
  if (reply.kind === "text") return sseResponse([chunk({ role: "assistant", content: "" }), chunk({ content: reply.text }), chunk({}, "stop"), usage, "[DONE]"]);
  return sseResponse([chunk({ role: "assistant", content: null }), chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: reply.name, arguments: JSON.stringify(reply.args) } }] }), chunk({}, "tool_calls"), usage, "[DONE]"]);
}) as any;

async function run(label: string, fn: () => Promise<unknown>) {
  const t0 = Date.now();
  try { return { label, ms: Date.now() - t0, out: await fn() }; }
  catch (e: any) { return { label, ms: Date.now() - t0, threw: String(e?.message ?? e).slice(0, 300), stack: String(e?.stack ?? "").split("\n").slice(0, 4) }; }
}
const opts = { model: "openai-compatible/m", provider: { apiKey: "k", baseUrl: "https://mock.invalid/v1" } } as const;
const toolRes = (r: any) => r.isOk() ? r.value.messages.filter((m: any) => m.role === "toolResult").map((m: any) => ({ err: m.isError, t: m.content?.[0]?.text?.slice(0, 140) })) : r.error;

export default {
  async fetch(_req: Request) {
    const out: any[] = [];
    out.push(await run("create+prompt text", async () => {
      script = [{ kind: "text", text: "hello from worker" }]; calls = 0;
      const c = await createCodingAgent({ ...opts });
      if (c.isErr()) return c.error;
      const events: string[] = [];
      c.value.subscribe((e) => events.push(e.type));
      const r = await c.value.prompt("hi");
      const state = c.value.state.status;
      await c.value.close();
      return { ok: r.isOk(), last: r.isOk() ? JSON.stringify(r.value.messages.at(-1)?.content) : r.error, state, eventTypes: [...new Set(events)] };
    }));
    out.push(await run("virtual fs sanity", async () => { await fs.mkdir("/tmp/ws", { recursive: true }); await fs.writeFile("/tmp/ws/a.txt", "hello"); return await fs.readFile("/tmp/ws/a.txt", "utf8"); }));
    out.push(await run("Read tool on virtual fs", async () => {
      script = [{ kind: "tool", name: "Read", args: { path: "/tmp/ws/a.txt" } }, { kind: "text", text: "done" }]; calls = 0;
      const c = await createCodingAgent({ ...opts, cwd: "/tmp/ws", permissionMode: "allow" });
      if (c.isErr()) return c.error;
      const r = await c.value.prompt("read"); await c.value.close(); return toolRes(r);
    }));
    out.push(await run("Write tool on virtual fs", async () => {
      script = [{ kind: "tool", name: "Write", args: { path: "/tmp/ws/w.txt", content: "x" } }, { kind: "text", text: "done" }]; calls = 0;
      const c = await createCodingAgent({ ...opts, cwd: "/tmp/ws", permissionMode: "allow" });
      if (c.isErr()) return c.error;
      const r = await c.value.prompt("write"); await c.value.close(); return { tr: toolRes(r), content: await fs.readFile("/tmp/ws/w.txt", "utf8").catch((e) => String(e)) };
    }));
    out.push(await run("Bash tool", async () => {
      script = [{ kind: "tool", name: "Bash", args: { command: "echo hi" } }, { kind: "text", text: "done" }]; calls = 0;
      const c = await createCodingAgent({ ...opts, cwd: "/tmp/ws", permissionMode: "allow" });
      if (c.isErr()) return c.error;
      const r = await c.value.prompt("bash"); await c.value.close(); return toolRes(r);
    }));
    out.push(await run("Bash with approver allowOnce", async () => {
      script = [{ kind: "tool", name: "Bash", args: { command: "echo hi" } }, { kind: "text", text: "done" }]; calls = 0;
      const approvals: any[] = [];
      const c = await createCodingAgent({ ...opts, cwd: "/tmp/ws", permissionMode: "ask", requestApproval: (req) => { approvals.push({ tool: req.toolName, reason: req.reason, risk: req.summary.risk }); return "allowOnce"; } });
      if (c.isErr()) return c.error;
      const r = await c.value.prompt("bash"); await c.value.close(); return { approvals, tr: toolRes(r) };
    }));
    out.push(await run("coldstart-ish: 30 agents sequential", async () => {
      let ok = 0;
      for (let i = 0; i < 30; i++) { script = [{ kind: "text", text: "x" }]; calls = 0; const c = await createCodingAgent({ ...opts, tools: [] }); if (c.isErr()) continue; const r = await c.value.prompt("hi"); if (r.isOk()) ok++; await c.value.close(); }
      return ok;
    }));
    out.push(await run("tools: [] (no built-ins)", async () => {
      script = [{ kind: "text", text: "pure chat" }]; calls = 0;
      const c = await createCodingAgent({ ...opts, tools: [] });
      if (c.isErr()) return c.error;
      const r = await c.value.prompt("hi"); await c.value.close(); return r.isOk();
    }));
    return Response.json(out, { headers: { "content-type": "application/json" } });
  },
};
