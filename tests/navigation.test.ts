import { expect, it } from "vitest";
import { Language, QuizType } from "../src/shared/types";
import { QuizMode } from "../src/inmankist/types";
import { languages, variants } from "./support/catalog";
import { begin, finish } from "./support/flow";
import { buttons, createBot } from "./support/bot";
import { log, redisEntries } from "./support/state";

for (const quiz of Object.values(QuizType)) {
  it("/" + quiz + " is informational and /start provides a route into the quiz", async () => {
    const h = createBot();
    await h.callback("lang:en");
    await h.command("/" + quiz);
    expect(String(h.latest()!.payload.text).length).toBeGreaterThan(0);
    await h.command("/start");
    expect(buttons(h.latest()).some((b) => b.callback_data === "quiz:" + quiz)).toBe(true);
  });
  for (const language of languages)
    it("/" + quiz + " introduction uses " + language, async () => {
      const h = createBot();
      await h.callback("lang:" + language);
      await h.command("/" + quiz);
      const text = String(h.latest()!.payload.text);
      if (language === Language.English) {
        expect(text).not.toMatch(/[\u0600-\u06ff\u0400-\u04ff]/);
      } else if (language === Language.Russian) expect(text).toMatch(/[\u0400-\u04ff]/);
      else {
        expect(text).toMatch(/[\u0600-\u06ff]/);
        expect(text).not.toMatch(/[\u0400-\u04ff]/);
      }
    });
}

for (const { quiz, gender } of variants)
  it(quiz + " / " + gender + ": published detail buttons dispatch successfully", async () => {
    const h = await begin(quiz, Language.English, QuizMode.SM, gender);
    await finish(h);
    const detailMessages = h.calls.filter((c) => buttons(c).some((b) => b.callback_data?.startsWith("detail:")));
    for (const origin of detailMessages)
      for (const button of buttons(origin).filter((b) => b.callback_data?.startsWith("detail:"))) {
        const n = h.calls.length;
        await h.callback(button.callback_data!, origin);
        expect(h.calls.slice(n).some((c) => c.method === "sendMessage" || c.method === "sendPhoto")).toBe(true);
      }
    expect(log.error).not.toHaveBeenCalled();
  });

it("saved-result replay gracefully rejects malformed cached JSON", async () => {
  const h = createBot();
  redisEntries.set("inmankist:quizresult:" + h.userId + ":mentalage", { value: "{broken", expiresAt: Infinity });
  await h.callback("lang:en");
  await h.callback("quiz:mentalage");
  expect(buttons(h.latest()).map((b) => b.callback_data)).toEqual(["mode:0", "mode:1", "mode:2"]);
});
