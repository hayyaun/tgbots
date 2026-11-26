import { afterEach, expect, it, vi } from "vitest";
import { Language, QuizType } from "../src/shared/types";
import { getUserData, setUserData, updateUserData, deleteUserData } from "../src/inmankist/userData";
import { getQuizResult, storeQuizResult } from "../src/inmankist/quizResults";
import { getUserLanguage, setUserLanguage, hasUserLanguage, refreshUserLanguageTTL } from "../src/shared/i18n/language";
import { session } from "./support/catalog";
import { failures, newUserId, redis, redisEntries, users } from "./support/state";

afterEach(() => vi.useRealTimers());
it("active quiz reads use the cache; an expired cache rehydrates serialized answers and question order", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const id = newUserId(),
    user = session(QuizType.MBTI);
  user.answers[user.order[0]] = 0;
  await setUserData(id, user);
  expect(await getUserData(id)).toEqual(user);
  expect(redis.getWithPrefix).not.toHaveBeenCalled();
  vi.setSystemTime(new Date("2026-01-01T00:31:00Z"));
  const rehydrated = await getUserData(id);
  expect(rehydrated).toEqual(user);
  expect(rehydrated).not.toBe(user);
  await updateUserData(id, { answers: { ...rehydrated!.answers, [user.order[0]]: 3 } });
  vi.setSystemTime(new Date("2026-01-01T01:02:00Z"));
  expect((await getUserData(id))!.answers[user.order[0]]).toBe(3);
});
it("quiz sessions expire at their 24-hour storage TTL, not at the shorter cache TTL", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const id = newUserId();
  await setUserData(id, session(QuizType.MentalAge));
  vi.setSystemTime(new Date("2026-01-01T23:59:59Z"));
  expect(await getUserData(id)).not.toBeNull();
  // Expire both the refreshed local read cache and the underlying storage entry.
  vi.setSystemTime(new Date("2026-01-02T00:31:00Z"));
  expect(await getUserData(id)).toBeNull();
});
it("deleting a session clears both cache and storage without deleting another user's state", async () => {
  const a = newUserId(),
    b = newUserId();
  await setUserData(a, session(QuizType.MBTI));
  await setUserData(b, session(QuizType.MentalAge));
  await deleteUserData(a);
  expect(await getUserData(a)).toBeNull();
  expect(await getUserData(b)).not.toBeNull();
});
it("saved results are partitioned by both quiz and user and expire after 48 hours", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const a = newUserId(),
    b = newUserId();
  await storeQuizResult(a, QuizType.MBTI, { type: "intj", distribution: [] });
  await storeQuizResult(a, QuizType.MentalAge, { age: 42 });
  await storeQuizResult(b, QuizType.MentalAge, { age: 99 });
  expect(await getQuizResult(a, QuizType.MentalAge)).toEqual({ age: 42 });
  expect(await getQuizResult(b, QuizType.MentalAge)).toEqual({ age: 99 });
  expect(await getQuizResult(b, QuizType.MBTI)).toBeNull();
  vi.setSystemTime(new Date("2026-01-03T00:00:00Z"));
  expect(await getQuizResult(a, QuizType.MentalAge)).toBeNull();
});
it("language lookup prefers Redis and falls back to the database during a Redis outage", async () => {
  const id = newUserId();
  users.set(String(id), { id: BigInt(id), telegram_id: BigInt(id), language: Language.Russian });
  await setUserLanguage(id, Language.English);
  expect(await getUserLanguage(id)).toBe(Language.English);
  users.get(String(id))!.language = Language.Russian;
  failures.read = true;
  expect(await getUserLanguage(id)).toBe(Language.Russian);
  expect(await hasUserLanguage(id)).toBe(true);
});
it("language lookup defaults safely when neither backing service is available", async () => {
  failures.read = true;
  failures.dbRead = true;
  expect(await getUserLanguage(newUserId())).toBe(Language.Persian);
  expect(await hasUserLanguage(newUserId())).toBe(false);
});
it.each([Language.Persian, Language.English, Language.Russian, Language.Arabic])(
  "an explicitly selected %s language renews its TTL on interaction",
  async (language) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const id = newUserId();
    await setUserLanguage(id, language);
    vi.setSystemTime(new Date("2026-01-14T00:00:00Z"));
    await refreshUserLanguageTTL(id);
    const record = redisEntries.get("shared:user:" + id + ":lang")!;
    expect(record.expiresAt).toBe(Date.now() + 14 * 24 * 60 * 60 * 1000);
  },
);

it("out-of-order background writes cannot resurrect an older answer after cache expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const id = newUserId(),
    user = session(QuizType.MentalAge);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  redis.setWithPrefix.mockImplementationOnce(async (prefix, name, value, ttl) => {
    await gate;
    redisEntries.set(prefix + ":" + name, { value, expiresAt: Date.now() + ttl! * 1000 });
  });
  user.answers[user.order[0]] = 0;
  await setUserData(id, user);
  await updateUserData(id, { answers: { [user.order[0]]: 3 } });
  release();
  await gate;
  await Promise.resolve();
  vi.setSystemTime(new Date("2026-01-01T00:31:00Z"));
  expect((await getUserData(id))!.answers[user.order[0]]).toBe(3);
});
