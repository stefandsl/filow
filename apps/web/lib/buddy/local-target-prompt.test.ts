import { afterEach, expect, it, vi } from "vitest";
import { askBuddy, buddyCloudRecipient, type BuddyAskRequest, type AskShape } from "./providers";
import { buddySystemPrompt, withScreenNote } from "./prompt";
import { isSimpleLocatorQuestion } from "./local-target-prompt";
import { consentKey, freellmRecipient } from "./outbound";
import { withLocalDate } from "../../../desktop/prompt-date";
import { variantPrompt, variantQuestion } from "../../../../tools/eval/hardening-prompt-variants";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const screens = [{ index: 1, width: 1920, height: 1080 }];
const question = 'Where is the Pay now button?\n(Found on the screen: "Pay now" is at 769,906. It is visible: if the question is about it, point at it with exactly that position.)';
async function request(provider: "local" | "cloud" | "freellm", overrides: Partial<BuddyAskRequest> = {}, model = "lfm3-vl", pictures = true, shape?: AskShape) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 10, 14, 12));
  vi.stubEnv("FILOW_OFFLINE", "0"); vi.stubEnv("OPENROUTER_API_KEY", "test");
  vi.stubEnv("FREELLMAPI_API_KEY", "test"); vi.stubEnv("FREELLMAPI_BASE_URL", "http://127.0.0.1:4995");
  const bodies: Array<{ messages: Array<{content: unknown}> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url).endsWith("/api/version")) return Response.json({version:"0.40.16"});
    bodies.push(JSON.parse(init.body));
    return new Response(provider === "local" ? '{"message":{"content":"Here."},"done":true}\n' : 'data: {"choices":[{"delta":{"content":"Here."}}]}\n\ndata: [DONE]\n\n');
  }));
  const consent = provider === "cloud" ? consentKey("ask", buddyCloudRecipient()) : provider === "freellm" ? consentKey("ask", freellmRecipient()) : undefined;
  for await (const _piece of askBuddy(provider, {question,images:["data:image/jpeg;base64,AA=="],screens,language:"en",knownTarget:true,consent,...overrides}, undefined, {model,pictures}, shape)) { /* drain */ }
  expect(bodies).toHaveLength(1);
  return bodies[0];
}
it.each(["lfm3-vl", "lfm3-vl:latest"])("sends the exact measured compact system and user text for %s", async model => {
  const body = await request("local", {}, model);
  expect(body.messages[0].content).toBe(variantPrompt("compact-exact", screens));
  expect(body.messages[1].content).toBe(variantQuestion("compact-exact", question));
});
it.each(["cloud", "freellm"] as const)("leaves %s prompts unchanged even with a forged target flag", async provider => {
  const body = await request(provider);
  expect(body.messages[0].content).toBe(withLocalDate(buddySystemPrompt(screens,"en",{pictures:true}),new Date()));
  expect(body.messages[1].content).toEqual([{type:"text",text:withScreenNote(question,true)},{type:"image_url",image_url:{url:"data:image/jpeg;base64,AA=="}}]);
});
it.each([
  [{knownTarget:false}, "lfm3-vl", true],
  [{knownTarget:undefined}, "lfm3-vl", true],
  [{language:"it"}, "lfm3-vl", true],
  [{screens:[...screens,{index:2,width:1920,height:1080}]}, "lfm3-vl", true],
  [{}, "gemma4:e4b", true],
  [{}, "lfm3-vl", false],
] as Array<[Partial<BuddyAskRequest>, string, boolean]>)("keeps the original prompt outside the measured scope: %j %s %s", async (overrides, model, pictures) => {
  const req = overrides;
  const body = await request("local", req, model, pictures);
  expect(body.messages[0].content).toBe(withLocalDate(buddySystemPrompt(req.screens ?? screens, req.language ?? "en", {pictures}),new Date()));
  expect(body.messages[1].content).toBe(withScreenNote(question,pictures));
});
it("preserves custom structured instructions", async () => {
  const body = await request("local", {}, "lfm3-vl", true, {system:"Return JSON",format:{}});
  expect(body.messages[0].content).toBe(withLocalDate("Return JSON",new Date()));
  expect(body.messages[1].content).toBe(question);
});
it.each(["Where is Export?", "Where are the tabs?", "Show me the invoice total field."])("recognizes a simple locator: %s", q => expect(isSimpleLocatorQuestion(q)).toBe(true));
it.each(["Show me how to export", "Where is Export and what does it do?", "Explain this chart", "Where is Export?\nThen explain it."])("keeps broader questions out: %s", q => expect(isSimpleLocatorQuestion(q)).toBe(false));
