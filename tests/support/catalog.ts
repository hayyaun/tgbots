import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Gender, Language, QuizType } from "../../src/shared/types";
import { QuizMode, type IUserData, type Value } from "../../src/inmankist/types";
import * as archetypeData from "../../src/inmankist/archetype/data";
import * as mbtiData from "../../src/inmankist/mbti/data";
import * as cognitiveData from "../../src/inmankist/leftright/data";
import * as politicalData from "../../src/inmankist/politicalcompass/data";
import * as enneagramData from "../../src/inmankist/enneagram/data";
import * as bigFiveData from "../../src/inmankist/bigfive/data";
import * as mentalAgeData from "../../src/inmankist/mentalage/data";
import { calculateResult as archetype } from "../../src/inmankist/archetype/events";
import { calculateResult as mbti } from "../../src/inmankist/mbti/events";
import { calculateResult as leftright } from "../../src/inmankist/leftright/events";
import { calculateResult as politicalcompass } from "../../src/inmankist/politicalcompass/events";
import { calculateResult as enneagram } from "../../src/inmankist/enneagram/events";
import { calculateResult as bigfive } from "../../src/inmankist/bigfive/events";
import { calculateResult as mentalage } from "../../src/inmankist/mentalage/events";
export const languages = Object.values(Language);
export const modes = [QuizMode.SM, QuizMode.MD, QuizMode.LG];
export const sizes = [5, 15, 25];
export const calculators = { archetype, mbti, leftright, politicalcompass, enneagram, bigfive, mentalage };
const data = {
  mbti: mbtiData,
  leftright: cognitiveData,
  politicalcompass: politicalData,
  enneagram: enneagramData,
  bigfive: bigFiveData,
  mentalage: mentalAgeData,
};
// Independent catalog order comes from the named quiz dimensions, not the production loader.
export const categoryFiles: Record<QuizType, string[]> = {
  archetype: [],
  mbti: ["E", "I", "S", "N", "T", "F", "J", "P"],
  leftright: ["left", "right"],
  politicalcompass: ["economic_left", "economic_right", "authoritarian", "libertarian"],
  enneagram: Array.from({ length: 9 }, (_, i) => "type" + (i + 1)),
  bigfive: [
    "Intellect",
    "Aesthetics",
    "Industriousness",
    "Orderliness",
    "Enthusiasm",
    "Assertiveness",
    "Compassion",
    "Politeness",
    "Withdrawal",
    "Volatility",
  ],
  mentalage: ["questions"],
};
export const maleDeities = ["zeus", "hades", "apollo", "ares", "dionysus", "hermes", "hephaestus", "poseidon"];
export const femaleDeities = ["hera", "demeter", "persephone", "artemis", "athena", "aphrodite", "hestia"];
export const variants = Object.values(QuizType).flatMap((quiz) =>
  quiz === QuizType.Archetype
    ? [Gender.male, Gender.female].map((gender) => ({ quiz, gender }))
    : [{ quiz, gender: undefined as Gender | undefined }],
);
export type Question = { text: string; category: string };
export function banks(quiz: QuizType, language: Language, gender?: Gender): Question[][] {
  const categories =
    quiz === QuizType.Archetype ? (gender === Gender.male ? maleDeities : femaleDeities) : categoryFiles[quiz];
  return categories.map((file) =>
    (
      JSON.parse(readFileSync(resolve("src/inmankist", quiz, "json", language, file + ".json"), "utf8")) as string[]
    ).map((text) => ({ text, category: quiz === QuizType.MentalAge ? "mentalage" : file })),
  );
}
export function sample(quiz: QuizType, size: number, language: Language, gender?: Gender) {
  return quiz === QuizType.Archetype
    ? archetypeData.getSample(gender!, size, language)
    : data[quiz].getSample(size, language);
}
export function question(user: IUserData, index: number) {
  return user.quiz === QuizType.Archetype
    ? archetypeData.getQuestionByQuestionIndex(user, index)
    : data[user.quiz].getQuestionByQuestionIndex(user, index);
}
export function session(quiz: QuizType, language = Language.English, gender?: Gender, size = 5): IUserData {
  const groups = banks(quiz, language, gender);
  let offset = 0;
  const order = groups.flatMap((group) => {
    const picked = Array.from({ length: Math.min(size, group.length) }, (_, n) => offset + n);
    offset += group.length;
    return picked;
  });
  return { date: Date.now(), quiz, language, gender, mode: QuizMode.SM, order, answers: {} };
}
export function answerAll(user: IUserData, value: (category: string, index: number) => number) {
  const bank = banks(user.quiz, user.language!, user.gender).flat();
  user.answers = Object.fromEntries(user.order.map((index) => [index, value(bank[index].category, index) as Value]));
  return user;
}
export function totals(user: IUserData) {
  const bank = banks(user.quiz, user.language!, user.gender).flat();
  const scores: Record<string, number> = {},
    counts: Record<string, number> = {};
  for (const index of user.order) {
    const { category } = bank[index];
    scores[category] = (scores[category] ?? 0) + user.answers[index];
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return { scores, counts };
}
export function storedValue(quiz: QuizType, result: unknown): string {
  if (quiz === QuizType.Archetype || quiz === QuizType.Enneagram) return (result as [string, number][])[0][0];
  if (quiz === QuizType.MBTI) return (result as { type: string }).type.toUpperCase();
  if (quiz === QuizType.LeftRight) return (result as { resultType: string }).resultType;
  if (quiz === QuizType.PoliticalCompass) return (result as { quadrant: string }).quadrant;
  if (quiz === QuizType.BigFive) return JSON.stringify(result);
  return String((result as { age: number }).age);
}
