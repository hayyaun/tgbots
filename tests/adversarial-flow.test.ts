import { describe, expect, it } from "vitest";
import { Gender, Language, QuizType } from "../src/shared/types";
import { QuizMode } from "../src/inmankist/types";
import { getUserData, deleteUserData } from "../src/inmankist/userData";
import { getQuizResult } from "../src/inmankist/quizResults";
import { getUserLanguage } from "../src/shared/i18n/language";
import { begin, finish, questionIndex } from "./support/flow";
import { createBot } from "./support/bot";
import { failures, log, prisma, redisEntries } from "./support/state";

describe("untrusted and stale callbacks", () => {
  it.each(["4", "999", "9007199254740993"])("rejects answer value %s without changing quiz state", async (value) => {
    const h = await begin(),
      origin = h.latestQuestion(),
      index = questionIndex(origin);
    const before = structuredClone(await getUserData(h.userId));
    await h.callback("answer:" + index + "-" + value, origin);
    expect(await getUserData(h.userId)).toEqual(before);
  });
  it("rejects a valid bank question which was not selected for this quiz", async () => {
    const h = await begin(),
      before = structuredClone((await getUserData(h.userId))!);
    const foreign = Array.from({ length: 15 }, (_, n) => n).find((n) => !before.order.includes(n))!;
    await h.callback("answer:" + foreign + "-3");
    expect(await getUserData(h.userId)).toEqual(before);
  });
  it("rejects a forged out-of-range question index", async () => {
    const h = await begin(),
      before = structuredClone(await getUserData(h.userId));
    await h.callback("answer:999999-3");
    expect(await getUserData(h.userId)).toEqual(before);
  });
  it.each(["prefix", "suffix"])("rejects callback data with extra %s text", async (position) => {
    const h = await begin(),
      index = questionIndex(h.latestQuestion());
    const before = structuredClone(await getUserData(h.userId));
    const data = "answer:" + index + "-3";
    await h.callback(position === "prefix" ? "junk" + data : data + "junk");
    expect(await getUserData(h.userId)).toEqual(before);
  });
  it("an old quiz message cannot answer a newly started quiz", async () => {
    const h = await begin(),
      oldMessage = h.latestQuestion(),
      index = questionIndex(oldMessage);
    await h.callback("quiz:mbti");
    await h.callback("mode:0");
    const before = structuredClone(await getUserData(h.userId));
    await h.callback("answer:" + index + "-3", oldMessage);
    expect(await getUserData(h.userId)).toEqual(before);
  });
  it("resampling a different mode cannot retain old answers against new question IDs", async () => {
    const h = await begin(QuizType.MBTI),
      origin = h.latestQuestion(),
      index = questionIndex(origin);
    await h.callback("answer:" + index + "-2", origin);
    await h.callback("mode:1");
    const user = (await getUserData(h.userId))!;
    if (user.mode === QuizMode.MD) expect(user.answers).toEqual({});
    else expect(user.mode).toBe(QuizMode.SM);
  });
  it("a stale gender-selection button cannot reassign answered questions to a different bank", async () => {
    const h = await begin(QuizType.Archetype, Language.English, QuizMode.SM, Gender.male);
    const origin = h.latestQuestion(),
      index = questionIndex(origin);
    await h.callback("answer:" + index + "-3", origin);
    await h.callback("gender:female");
    const user = (await getUserData(h.userId))!;
    if (user.gender === Gender.female) expect(user.answers).toEqual({});
    else expect(user.gender).toBe(Gender.male);
  });
  it.each(["lang:unsupported", "quiz:unsupported", "mode:999"])(
    "rejects invalid selection %s without corrupting the active session",
    async (data) => {
      const h = await begin(),
        before = structuredClone(await getUserData(h.userId));
      await h.callback(data);
      expect(await getUserData(h.userId)).toEqual(before);
      expect(Object.values(Language)).toContain(await getUserLanguage(h.userId));
    },
  );
  it("rejects an invalid archetype gender", async () => {
    const h = await begin(QuizType.Archetype, Language.English, QuizMode.SM, Gender.male);
    const before = structuredClone(await getUserData(h.userId));
    await h.callback("gender:unsupported");
    expect(await getUserData(h.userId)).toEqual(before);
  });
});

it("an answer cannot finish a quiz before mode selection has created its question order", async () => {
  const h = createBot();
  await h.callback("lang:en");
  await h.callback("quiz:mentalage");
  const before = structuredClone(await getUserData(h.userId));
  await h.callback("answer:0-3");
  expect(await getUserData(h.userId)).toEqual(before);
  expect(await getQuizResult(h.userId, QuizType.MentalAge)).toBeNull();
});
it("an answer for a selected but not-yet-displayed question cannot skip ahead", async () => {
  const h = await begin(),
    before = structuredClone((await getUserData(h.userId))!);
  await h.callback("answer:" + before.order[1] + "-3");
  expect(await getUserData(h.userId)).toEqual(before);
});

describe("completion, interruption and recovery", () => {
  it("an expired session acknowledges the tap and asks the user to restart", async () => {
    const h = await begin(),
      origin = h.latestQuestion();
    await deleteUserData(h.userId);
    const n = h.calls.length;
    await h.callback("answer:" + questionIndex(origin) + "-3", origin);
    expect(h.calls.slice(n).some((c) => c.method === "answerCallbackQuery")).toBe(true);
    expect(h.calls.slice(n).some((c) => c.method === "sendMessage")).toBe(true);
    expect(await getUserData(h.userId)).toBeNull();
    expect(await getQuizResult(h.userId, QuizType.MentalAge)).toBeNull();
  });
  it("an interrupted quiz preserves its answers across /start until the user chooses another quiz", async () => {
    const h = await begin(),
      origin = h.latestQuestion(),
      index = questionIndex(origin);
    await h.callback("answer:" + index + "-2", origin);
    const before = structuredClone(await getUserData(h.userId));
    await h.command("/start");
    expect(await getUserData(h.userId)).toEqual(before);
    await h.callback("quiz:mbti");
    expect((await getUserData(h.userId))!.answers).toEqual({});
  });
  it("language changes do not reinterpret the active quiz's question bank", async () => {
    const h = await begin(),
      origin = h.latestQuestion(),
      index = questionIndex(origin);
    await h.callback("answer:" + index + "-2", origin);
    await h.callback("lang:fa");
    const user = (await getUserData(h.userId))!;
    expect(user.language).toBe(Language.English);
    expect(user.answers[index]).toBe(2);
  });
  it("a completed result can be shown again without another database result write", async () => {
    const h = await begin();
    await finish(h);
    const result = await getQuizResult(h.userId, QuizType.MentalAge),
      before = h.calls.length;
    const writes = prisma.user.upsert.mock.calls.length;
    await h.callback("quiz:mentalage");
    expect(await getQuizResult(h.userId, QuizType.MentalAge)).toEqual(result);
    expect(h.calls.slice(before).some((c) => c.method === "sendMessage" && !String(c.payload.text).includes("/"))).toBe(
      true,
    );
    expect((await getUserData(h.userId))!.answers).toEqual({});
    expect(prisma.user.upsert).toHaveBeenCalledTimes(writes);
  });
  it("failed final Telegram delivery can be retried from the final answer button", async () => {
    const h = await begin(),
      order = [...(await getUserData(h.userId))!.order];
    for (let n = 0; n < order.length - 1; n++) await h.callback("answer:" + order[n] + "-2", h.latestQuestion());
    const finalMessage = h.latestQuestion(),
      finalIndex = questionIndex(finalMessage);
    h.failOnce.add("sendMessage");
    await h.callback("answer:" + finalIndex + "-2", finalMessage);
    expect(await getUserData(h.userId)).not.toBeNull();
    await h.callback("answer:" + finalIndex + "-2", finalMessage);
    expect(await getUserData(h.userId)).toBeNull();
  });
  it("a failed final result-cache write can be retried without restarting the quiz", async () => {
    const h = await begin(),
      order = [...(await getUserData(h.userId))!.order];
    for (let n = 0; n < order.length - 1; n++) await h.callback("answer:" + order[n] + "-1", h.latestQuestion());
    const finalMessage = h.latestQuestion(),
      index = questionIndex(finalMessage);
    failures.write = true;
    await h.callback("answer:" + index + "-1", finalMessage);
    failures.write = false;
    expect(await getQuizResult(h.userId, QuizType.MentalAge)).toBeNull();
    await h.callback("answer:" + index + "-1", finalMessage);
    expect(await getQuizResult(h.userId, QuizType.MentalAge)).not.toBeNull();
    expect(await getUserData(h.userId)).toBeNull();
  });
  it("database failure does not prevent displaying and caching the computed result", async () => {
    const h = await begin();
    failures.dbWrite = true;
    await finish(h, 3);
    expect(await getQuizResult(h.userId, QuizType.MentalAge)).toEqual({ age: 100 });
    expect(await getUserData(h.userId)).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });
  it("failure to edit an earlier keyboard does not lose an accepted answer", async () => {
    const h = await begin(),
      origin = h.latestQuestion(),
      index = questionIndex(origin);
    h.failOnce.add("editMessageReplyMarkup");
    await h.callback("answer:" + index + "-3", origin);
    expect((await getUserData(h.userId))!.answers[index]).toBe(3);
    expect(questionIndex(h.latestQuestion())).not.toBe(index);
  });
  it("two rapid deliveries of the final answer do not publish two results", async () => {
    const h = await begin(),
      order = [...(await getUserData(h.userId))!.order];
    for (let n = 0; n < order.length - 1; n++) await h.callback("answer:" + order[n] + "-1", h.latestQuestion());
    const origin = h.latestQuestion(),
      index = questionIndex(origin),
      n = h.calls.length;
    await Promise.all([h.callback("answer:" + index + "-3", origin), h.callback("answer:" + index + "-3", origin)]);
    expect(h.calls.slice(n).filter((c) => c.method === "sendMessage")).toHaveLength(2); // Result and follow-up.
    expect(await getUserData(h.userId)).toBeNull();
  });
  it("corrupt persisted quiz data is handled as an expired session rather than leaving a dead button", async () => {
    const h = createBot();
    redisEntries.set("inmankist:userdata:" + h.userId, { value: "{broken", expiresAt: Infinity });
    await h.callback("answer:0-2");
    expect(h.calls.some((c) => c.method === "sendMessage")).toBe(true);
  });
  it("session cleanup failure does not cause duplicate completion on the next tap", async () => {
    const h = await begin();
    failures.delete = true;
    await finish(h, 2);
    failures.delete = false;
    expect(await getQuizResult(h.userId, QuizType.MentalAge)).not.toBeNull();
    // Correct behavior must still allow cleanup/recovery without recomputing a different result.
    const user = (await getUserData(h.userId))!;
    const index = user.order.at(-1)!;
    await h.callback("answer:" + index + "-2", h.latestQuestion());
    expect(await getUserData(h.userId)).toBeNull();
  });
});
