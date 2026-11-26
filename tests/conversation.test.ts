import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Gender, Language, QuizType } from "../src/shared/types";
import { QuizMode } from "../src/inmankist/types";
import { getUserData } from "../src/inmankist/userData";
import { getQuizResult } from "../src/inmankist/quizResults";
import { calculators, languages, modes, storedValue, variants } from "./support/catalog";
import { expectedResult } from "./support/oracle";
import { begin, finish, questionIndex } from "./support/flow";
import { buttons, createBot } from "./support/bot";
import { drawings, log, prisma, users } from "./support/state";

const field: Record<QuizType, string> = {
  archetype: "archetype_result",
  mbti: "mbti_result",
  leftright: "leftright_result",
  politicalcompass: "politicalcompass_result",
  enneagram: "enneagram_result",
  bigfive: "bigfive_result",
  mentalage: "mentalage_result",
};

describe.each(variants)("$quiz start-to-result / $gender", ({ quiz, gender }) => {
  for (const language of languages)
    for (const mode of modes) {
      it(
        language + " / mode " + mode + ": start, selections, every question, display, cache, database and cleanup",
        async () => {
          const h = await begin(quiz, language, mode, gender);
          const model = structuredClone((await getUserData(h.userId))!);
          expect(new Set(model.order).size).toBe(model.order.length);
          for (let n = 0; n < model.order.length; n++) {
            const origin = h.latestQuestion(),
              index = questionIndex(origin);
            expect(index).toBe(model.order[n]);
            expect(String(origin!.payload.text)).toContain(n + 1 + "/" + model.order.length);
            const value = n % 4;
            model.answers[index] = value;
            await h.callback("answer:" + index + "-" + value, origin);
          }
          const cached = await getQuizResult(h.userId, quiz);
          expect(cached).not.toBeNull();
          if (quiz === QuizType.Archetype || quiz === QuizType.Enneagram) {
            expect(Object.fromEntries(cached as [string, number][])).toEqual(expectedResult(model));
          } else if (quiz === QuizType.PoliticalCompass) {
            expect(cached).toEqual(calculators[quiz](model));
            const a = cached as { economicScore: number; socialScore: number };
            const b = expectedResult(model) as typeof a;
            expect(a.economicScore).toBeCloseTo(b.economicScore, 10);
            expect(a.socialScore).toBeCloseTo(b.socialScore, 10);
          } else expect(cached).toEqual(expectedResult(model));
          expect(users.get(String(h.userId))?.[field[quiz]]).toBe(storedValue(quiz, cached));
          expect(await getUserData(h.userId)).toBeNull();
          expect(log.error).not.toHaveBeenCalled();
          expect(h.calls.filter((c) => c.method === "answerCallbackQuery")).toHaveLength(
            model.order.length + (quiz === QuizType.Archetype ? 4 : 3),
          );
          for (const call of h.calls) {
            const text = String(call.payload.text ?? call.payload.caption ?? "");
            expect(text).not.toMatch(/NaN|undefined|Infinity/);
            expect(text.length).toBeLessThanOrEqual(call.method === "sendPhoto" ? 1024 : 4096);
          }
          if ([QuizType.Archetype, QuizType.MBTI, QuizType.PoliticalCompass].includes(quiz)) {
            expect(h.calls.some((c) => c.method === "sendPhoto")).toBe(true);
          }
          const oldQuestions = h.calls.filter(
            (c) => c.method === "sendMessage" && buttons(c).some((b) => b.callback_data?.startsWith("answer:")),
          ).length;
          expect(oldQuestions).toBe(model.order.length);
        },
      );
    }

  it("changing and repeating earlier answers neither advances twice nor loses the latest selection", async () => {
    const h = await begin(quiz, Language.English, QuizMode.SM, gender);
    const first = h.latestQuestion(),
      index = questionIndex(first);
    await h.callback("answer:" + index + "-0", first);
    const questionCount = h.calls.filter((c) => c.method === "sendMessage").length;
    await h.callback("answer:" + index + "-3", first);
    await h.callback("answer:" + index + "-3", first);
    expect(h.calls.filter((c) => c.method === "sendMessage")).toHaveLength(questionCount);
    expect((await getUserData(h.userId))!.answers[index]).toBe(3);
    const snapshot = await finish(h, 1);
    snapshot.answers[index] = 3;
    expect(await getQuizResult(h.userId, quiz)).toEqual(calculators[quiz](snapshot));
    expect(await getUserData(h.userId)).toBeNull();
  });
});

it("generated histories of edits and duplicate taps agree with a last-selection-wins model", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 30 }), async (revisions) => {
      const h = await begin();
      const origin = h.latestQuestion(),
        index = questionIndex(origin);
      await h.callback("answer:" + index + "-0", origin);
      const count = h.calls.filter((c) => c.method === "sendMessage").length;
      for (const value of revisions) await h.callback("answer:" + index + "-" + value, origin);
      expect((await getUserData(h.userId))!.answers[index]).toBe(revisions.at(-1));
      expect(h.calls.filter((c) => c.method === "sendMessage")).toHaveLength(count);
      const snapshot = await finish(h, 1);
      snapshot.answers[index] = revisions.at(-1)!;
      expect(await getQuizResult(h.userId, QuizType.MentalAge)).toEqual(expectedResult(snapshot));
    }),
    { seed: 20261126, numRuns: 40 },
  );
});

it("users cannot overwrite each other's quiz state or saved result", async () => {
  const a = await begin(),
    b = await begin(QuizType.MBTI);
  const aFirst = questionIndex(a.latestQuestion()),
    bFirst = questionIndex(b.latestQuestion());
  await Promise.all([a.callback("answer:" + aFirst + "-3"), b.callback("answer:" + bFirst + "-0")]);
  expect((await getUserData(a.userId))!.quiz).toBe(QuizType.MentalAge);
  expect((await getUserData(b.userId))!.quiz).toBe(QuizType.MBTI);
  expect(await getQuizResult(b.userId, QuizType.MentalAge)).toBeNull();
});

it("an existing profile gender bypasses the gender question while preserving profile fields", async () => {
  const h = createBot();
  users.set(String(h.userId), {
    id: BigInt(h.userId),
    telegram_id: BigInt(h.userId),
    gender: "female",
    display_name: "Custom name",
    username: "custom_handle",
  });
  await begin(QuizType.Archetype, Language.English, QuizMode.SM, undefined, h);
  expect((await getUserData(h.userId))!.gender).toBe("female");
  await finish(h);
  expect(users.get(String(h.userId))?.display_name).toBe("Custom name");
  expect(prisma.user.upsert).toHaveBeenCalled();
});

it("all-zero archetype answers never render NaN percentages", async () => {
  const h = await begin(QuizType.Archetype, Language.English, QuizMode.SM, Gender.male);
  await finish(h, 0);
  expect(drawings).toHaveLength(1);
  expect(drawings[0].left.join(" ")).not.toMatch(/NaN|Infinity/);
});
