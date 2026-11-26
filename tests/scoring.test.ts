import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Gender, Language, QuizType } from "../src/shared/types";
import { answerAll, calculators, languages, session, sizes, variants } from "./support/catalog";
import { expectedResult } from "./support/oracle";
import type { IUserData } from "../src/inmankist/types";

function check(user: IUserData) {
  const before = structuredClone(user);
  const actual = calculators[user.quiz](user);
  const expected = expectedResult(user);
  if (user.quiz === QuizType.Archetype || user.quiz === QuizType.Enneagram) {
    expect(Object.fromEntries(actual as [string, number][])).toEqual(expected);
    const values = (actual as [string, number][]).map(([, score]) => score);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  } else if (user.quiz === QuizType.PoliticalCompass) {
    const result = actual as { economicScore: number; socialScore: number; quadrant: string };
    const reference = expected as typeof result;
    expect(result.economicScore).toBeCloseTo(reference.economicScore, 10);
    expect(result.socialScore).toBeCloseTo(reference.socialScore, 10);
    expect(result.quadrant).toBe(reference.quadrant);
  } else expect(actual).toEqual(expected);
  expect(user).toEqual(before);
  return actual;
}

describe.each(variants)("$quiz scoring / $gender", ({ quiz, gender }) => {
  for (const language of languages)
    for (const size of sizes)
      for (const pattern of [0, 1, 2, 3, "mixed"] as const) {
        it(language + " / category sample " + size + " / " + pattern + ": matches independent arithmetic", () => {
          check(
            answerAll(session(quiz, language, gender, size), (_, index) => (pattern === "mixed" ? index % 4 : pattern)),
          );
        });
      }

  it("random answers and revisions preserve final-state scores and ignore question presentation order", () => {
    const base = session(quiz, Language.English, gender);
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: base.order.length, maxLength: base.order.length }),
        fc.array(fc.tuple(fc.nat({ max: base.order.length - 1 }), fc.integer({ min: 0, max: 3 })), { maxLength: 25 }),
        (values, revisions) => {
          const user = structuredClone(base);
          user.order.forEach((index, n) => {
            user.answers[index] = values[n];
          });
          for (const [position, value] of revisions) user.answers[user.order[position]] = value;
          const result = check(user);
          user.order.reverse();
          expect(calculators[quiz](user)).toEqual(result);
        },
      ),
      { seed: 20261126, numRuns: 100 },
    );
  });
});

it.each([
  "ESTJ",
  "ESTP",
  "ESFJ",
  "ESFP",
  "ENTJ",
  "ENTP",
  "ENFJ",
  "ENFP",
  "ISTJ",
  "ISTP",
  "ISFJ",
  "ISFP",
  "INTJ",
  "INTP",
  "INFJ",
  "INFP",
])("MBTI independently constructed %s profile", (type) => {
  const user = answerAll(session(QuizType.MBTI), (category) => (type.includes(category) ? 3 : 0));
  expect(calculators.mbti(user).type).toBe(type.toLowerCase());
});

it.each([
  ["economic_left", "authoritarian", "auth_left"],
  ["economic_right", "authoritarian", "auth_right"],
  ["economic_left", "libertarian", "lib_left"],
  ["economic_right", "libertarian", "lib_right"],
])("political compass places %s / %s in %s", (economic, social, quadrant) => {
  const user = answerAll(session(QuizType.PoliticalCompass), (category) =>
    [economic, social].includes(category) ? 3 : 0,
  );
  expect(calculators.politicalcompass(user).quadrant).toBe(quadrant);
});

it("mental-age endpoints are 5 and 100, without non-finite values", () => {
  expect(calculators.mentalage(answerAll(session(QuizType.MentalAge), () => 0))).toEqual({ age: 5 });
  expect(calculators.mentalage(answerAll(session(QuizType.MentalAge), () => 3))).toEqual({ age: 100 });
});
it("all-zero cognitive answers agree with their displayed balanced 50/50 percentages", () => {
  expect(calculators.leftright(answerAll(session(QuizType.LeftRight), () => 0))).toEqual({
    resultType: "balanced",
    leftPercentage: 50,
    rightPercentage: 50,
  });
});
it("archetype never mixes male/female categories", () => {
  const male = calculators.archetype(answerAll(session(QuizType.Archetype, Language.English, Gender.male), () => 3));
  const female = calculators.archetype(
    answerAll(session(QuizType.Archetype, Language.English, Gender.female), () => 3),
  );
  expect(male).toHaveLength(8);
  expect(female).toHaveLength(7);
  expect(male.some(([name]) => female.some(([other]) => name === other))).toBe(false);
});

it.each([
  [7, 3, "strong_left"],
  [11, 9, "left"],
  [9, 11, "balanced"],
  [3, 7, "right"],
  [2, 8, "strong_right"],
  [0, 10, "strong_right"],
  [10, 0, "strong_left"],
] as const)("cognitive classification boundary: %i left / %i right => %s", (left, right, expected) => {
  const remaining: Record<string, number> = { left, right };
  const user = answerAll(session(QuizType.LeftRight), (category) => {
    const value = Math.min(3, remaining[category]);
    remaining[category] -= value;
    return value;
  });
  expect(calculators.leftright(user).resultType).toBe(expected);
});
