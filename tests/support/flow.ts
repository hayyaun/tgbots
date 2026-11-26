import { expect } from "vitest";
import { Gender, Language, QuizType } from "../../src/shared/types";
import { QuizMode, type IUserData } from "../../src/inmankist/types";
import { getUserData } from "../../src/inmankist/userData";
import { buttons, createBot, type Call } from "./bot";
export type Harness = ReturnType<typeof createBot>;
export async function begin(
  quiz = QuizType.MentalAge,
  language = Language.English,
  mode = QuizMode.SM,
  gender?: Gender,
  existing?: Harness,
) {
  const h = existing ?? createBot();
  await h.command("/start");
  expect(buttons(h.latest()).map((b) => b.callback_data)).toEqual(["lang:fa", "lang:en", "lang:ru", "lang:ar"]);
  await h.callback("lang:" + language);
  expect(buttons(h.latest()).filter((b) => b.callback_data?.startsWith("quiz:"))).toHaveLength(7);
  await h.callback("quiz:" + quiz);
  expect(buttons(h.latest()).map((b) => b.callback_data)).toEqual(["mode:0", "mode:1", "mode:2"]);
  await h.callback("mode:" + mode);
  if (quiz === QuizType.Archetype && !h.latestQuestion()) {
    expect(buttons(h.latest()).map((b) => b.callback_data)).toEqual(["gender:male", "gender:female"]);
    await h.callback("gender:" + gender);
  }
  const user = await getUserData(h.userId);
  expect(user).not.toBeNull();
  expect(user!.quiz).toBe(quiz);
  expect(user!.language).toBe(language);
  return h;
}
export function questionIndex(origin: Call | undefined): number {
  const callback = buttons(origin).find((b) => b.callback_data?.startsWith("answer:"))?.callback_data;
  expect(callback).toBeDefined();
  return Number(callback!.split(":")[1].split("-")[0]);
}
export async function finish(h: Harness, value = 3): Promise<IUserData> {
  const initial = structuredClone((await getUserData(h.userId))!);
  for (let n = 0; n < initial.order.length; n++) {
    const user = await getUserData(h.userId);
    if (!user) break;
    const origin = h.latestQuestion(),
      index = questionIndex(origin);
    initial.answers[index] = value;
    await h.callback("answer:" + index + "-" + value, origin);
  }
  return initial;
}
