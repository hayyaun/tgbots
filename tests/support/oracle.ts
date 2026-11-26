import { QuizType } from "../../src/shared/types";
import type { IUserData } from "../../src/inmankist/types";
import { totals } from "./catalog";

// Independent arithmetic oracle: reads the raw bank, never production scores,
// question lookup, type classifiers or trait mappings.
export function expectedResult(user: IUserData): unknown {
  const { scores: s, counts } = totals(user);
  if (user.quiz === QuizType.Archetype || user.quiz === QuizType.Enneagram) return s;
  if (user.quiz === QuizType.MentalAge) {
    const sum = Object.values(s).reduce((a, b) => a + b, 0);
    return { age: Math.round(5 + (95 * sum) / (3 * user.order.length)) };
  }
  if (user.quiz === QuizType.MBTI) {
    const pairs = ["EI", "SN", "TF", "JP"];
    const winning = pairs.map((pair) => (s[pair[0]] > s[pair[1]] ? pair[0] : pair[1]));
    return {
      type: winning.join("").toLowerCase(),
      distribution: pairs.map((pair, i) => {
        const total = s[pair[0]] + s[pair[1]];
        return total
          ? { dimension: winning[i], percentage: Math.round((100 * Math.max(s[pair[0]], s[pair[1]])) / total) }
          : { dimension: pair[0] + "-" + pair[1], percentage: 50 };
      }),
    };
  }
  if (user.quiz === QuizType.LeftRight) {
    const total = s.left + s.right;
    const percentage = total ? (100 * s.left) / total : 50;
    const resultType =
      percentage >= 70
        ? "strong_left"
        : percentage >= 55
          ? "left"
          : percentage >= 45
            ? "balanced"
            : percentage >= 30
              ? "right"
              : "strong_right";
    return {
      resultType,
      leftPercentage: total ? Math.round((100 * s.left) / total) : 50,
      rightPercentage: total ? Math.round((100 * s.right) / total) : 50,
    };
  }
  if (user.quiz === QuizType.PoliticalCompass) {
    const economicScore = (100 * (s.economic_right - s.economic_left)) / (s.economic_right + s.economic_left || 1);
    const socialScore = (100 * (s.libertarian - s.authoritarian)) / (s.libertarian + s.authoritarian || 1);
    const quadrant =
      Math.abs(economicScore) < 20 && Math.abs(socialScore) < 20
        ? "center"
        : (socialScore < 0 ? "auth_" : "lib_") + (economicScore < 0 ? "left" : "right");
    return { economicScore, socialScore, quadrant };
  }
  const pairs: Record<string, string[]> = {
    Openness: ["Intellect", "Aesthetics"],
    Conscientiousness: ["Industriousness", "Orderliness"],
    Extraversion: ["Enthusiasm", "Assertiveness"],
    Agreeableness: ["Compassion", "Politeness"],
    Neuroticism: ["Withdrawal", "Volatility"],
  };
  return {
    aspects: Object.fromEntries(Object.keys(counts).map((k) => [k, Math.round((100 * s[k]) / (3 * counts[k]))])),
    traits: Object.fromEntries(
      Object.entries(pairs).map(([trait, keys]) => [
        trait,
        Math.round((100 * keys.reduce((sum, k) => sum + s[k], 0)) / (3 * keys.reduce((sum, k) => sum + counts[k], 0))),
      ]),
    ),
  };
}
