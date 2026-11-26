import { describe, expect, it, vi } from "vitest";
import { Gender, Language, QuizType } from "../src/shared/types";
import { getUserData, setUserData, deleteUserData } from "../src/inmankist/userData";
import { getQuizResult } from "../src/inmankist/quizResults";
import { getUserLanguage, hasUserLanguage, refreshUserLanguageTTL } from "../src/shared/i18n/language";
import { replyAbout, replyDetail, replyResult } from "../src/inmankist/politicalcompass/events";
import { Quadrant } from "../src/inmankist/politicalcompass/types";
import { getStrings } from "../src/inmankist/i18n";
import { begin, finish, questionIndex } from "./support/flow";
import { buttons, createBot } from "./support/bot";
import { session } from "./support/catalog";
import { failures, newUserId, prisma, redis, redisEntries } from "./support/state";
import type { Context } from "grammy";

async function atFinalQuestion() {
  const h = await begin();
  const order = (await getUserData(h.userId))!.order;
  for (let i = 0; i < order.length - 1; i++) {
    await h.callback(`answer:${order[i]}-2`, h.latestQuestion());
  }
  return h;
}

describe("recovery and callback ordering regressions", () => {
  it("a failed next-question send can be retried from the accepted earlier answer", async () => {
    const h = await begin();
    const origin = h.latestQuestion(),
      index = questionIndex(origin);
    h.failOnce.add("sendMessage");
    await h.callback(`answer:${index}-2`, origin);
    expect((await getUserData(h.userId))!.answers[index]).toBe(2);
    expect(questionIndex(h.latestQuestion())).toBe(index);
    await h.callback(`answer:${index}-2`, origin);
    expect(questionIndex(h.latestQuestion())).not.toBe(index);
    await finish(h);
    expect(await getUserData(h.userId)).toBeNull();
  });

  it.each([QuizType.MentalAge, QuizType.Archetype])(
    "a failed first question can be retried from its %s selection prompt",
    async (quiz) => {
      const h = createBot();
      await h.callback("lang:en");
      await h.callback("quiz:" + quiz);
      let data = "mode:0",
        origin = h.latest();
      if (quiz === QuizType.Archetype) {
        await h.callback(data, origin);
        data = "gender:male";
        origin = h.latest();
      }
      h.failOnce.add("sendMessage");
      await h.callback(data, origin);
      expect(h.latestQuestion()).toBeUndefined();
      await h.callback(data, origin);
      expect(h.latestQuestion()).toBeDefined();
      await finish(h);
      expect(await getUserData(h.userId)).toBeNull();
    },
  );

  it("a failed follow-up resumes without resending the result or saving the profile twice", async () => {
    const h = await atFinalQuestion(),
      origin = h.latestQuestion(),
      index = questionIndex(origin);
    let failed = false;
    h.bot.api.config.use(async (previous, method, payload, signal) => {
      if (
        method === "sendMessage" &&
        (payload as { text?: string }).text === getStrings(Language.English).matchfound_message &&
        !failed
      ) {
        failed = true;
        throw new Error("Injected follow-up failure");
      }
      return previous(method, payload, signal);
    });
    const start = h.calls.length;
    await h.callback(`answer:${index}-2`, origin);
    const result = await getQuizResult(h.userId, QuizType.MentalAge);
    expect(failed).toBe(true);
    expect((await getUserData(h.userId))!.completion?.profileSaved).toBe(true);
    const writes = prisma.user.upsert.mock.calls.length;
    const beforeRetry = h.calls.length;
    await h.callback(`answer:${index}-3`, origin);
    expect(await getUserData(h.userId)).toBeNull();
    expect(await getQuizResult(h.userId, QuizType.MentalAge)).toEqual(result);
    expect(prisma.user.upsert).toHaveBeenCalledTimes(writes);
    expect(h.calls.slice(beforeRetry).filter((c) => c.method === "sendMessage")).toHaveLength(1);
    expect(
      h.calls
        .slice(start)
        .filter(
          (c) => c.method === "sendMessage" && c.payload.text === getStrings(Language.English).matchfound_message,
        ),
    ).toHaveLength(1);
  });

  it("cleanup retry cannot revise or publish an already delivered result", async () => {
    const h = await atFinalQuestion(),
      origin = h.latestQuestion(),
      index = questionIndex(origin);
    failures.delete = true;
    await h.callback(`answer:${index}-1`, origin);
    const result = await getQuizResult(h.userId, QuizType.MentalAge);
    const writes = prisma.user.upsert.mock.calls.length,
      before = h.calls.length;
    failures.delete = false;
    await h.callback(`answer:${index}-3`, origin);
    expect(await getUserData(h.userId)).toBeNull();
    expect(await getQuizResult(h.userId, QuizType.MentalAge)).toEqual(result);
    expect(prisma.user.upsert).toHaveBeenCalledTimes(writes);
    expect(h.calls.slice(before).filter((c) => c.method === "sendMessage")).toHaveLength(0);
  });

  it("acknowledges queued taps immediately and sends only one next question", async () => {
    const h = await begin(),
      origin = h.latestQuestion(),
      index = questionIndex(origin);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let blocked = false;
    h.bot.api.config.use(async (previous, method, payload, signal) => {
      if (method === "sendMessage" && !blocked) {
        blocked = true;
        entered();
        await gate;
      }
      return previous(method, payload, signal);
    });
    const before = h.calls.length;
    const first = h.callback(`answer:${index}-1`, origin);
    await started;
    const second = h.callback(`answer:${index}-3`, origin);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(h.calls.slice(before).filter((c) => c.method === "answerCallbackQuery")).toHaveLength(2);
    } finally {
      release();
      await Promise.all([first, second]);
    }
    expect((await getUserData(h.userId))!.answers[index]).toBe(3);
    expect(
      h.calls
        .slice(before)
        .filter((c) => c.method === "sendMessage" && buttons(c).some((b) => b.callback_data?.startsWith("answer:"))),
    ).toHaveLength(1);
  });

  it("rejects an answer replayed in a different chat even when its message ID matches", async () => {
    const h = await begin(),
      origin = h.latestQuestion()!;
    const before = structuredClone(await getUserData(h.userId));
    const foreign = structuredClone(origin);
    foreign.message!.chat.id = -12345;
    await h.callback(`answer:${questionIndex(origin)}-3`, foreign);
    expect(await getUserData(h.userId)).toEqual(before);
  });

  it("rejects a mode from the wrong message before sampling any questions", async () => {
    const h = createBot();
    await h.callback("lang:en");
    const old = h.latest();
    await h.callback("quiz:mentalage");
    const before = structuredClone(await getUserData(h.userId));
    await h.callback("mode:0", old);
    expect(await getUserData(h.userId)).toEqual(before);
    expect(h.latestQuestion()).toBeUndefined();
  });

  it.each(["mode:0", "gender:male", "answer:0-2"])(
    "guides an older unbound session to restart on %s",
    async (callback) => {
      const h = createBot();
      await setUserData(h.userId, session(QuizType.Archetype, Language.English, Gender.male));
      await h.callback(callback);
      expect(h.calls.some((c) => c.method === "sendMessage" && String(c.payload.text).includes("/start"))).toBe(true);
    },
  );
});

describe("storage and language regression boundaries", () => {
  it("waits for a delayed background write before deletion so it cannot resurrect the session", async () => {
    const id = newUserId();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    redis.setWithPrefix.mockImplementationOnce(async (prefix, name, value) => {
      await gate;
      redisEntries.set(prefix + ":" + name, { value, expiresAt: Infinity });
    });
    await setUserData(id, session(QuizType.MentalAge));
    const deletion = deleteUserData(id);
    expect(redis.delWithPrefix).not.toHaveBeenCalled();
    release();
    await deletion;
    expect(redisEntries.has("inmankist:userdata:" + id)).toBe(false);
    expect(await getUserData(id)).toBeNull();
  });

  it.each(["null", "[]", "{}", '{"quiz":"unsupported"}'])(
    "rejects structurally invalid persisted sessions: %s",
    async (value) => {
      const id = newUserId();
      redisEntries.set("inmankist:userdata:" + id, { value, expiresAt: Infinity });
      expect(await getUserData(id)).toBeNull();
      expect(redisEntries.has("inmankist:userdata:" + id)).toBe(false);
    },
  );

  it("does not turn an unselected default language into a stored preference", async () => {
    const id = newUserId();
    await refreshUserLanguageTTL(id);
    expect(redisEntries.has("shared:user:" + id + ":lang")).toBe(false);
    expect(await hasUserLanguage(id)).toBe(false);
  });

  it("ignores an unsupported persisted language rather than returning it to the renderer", async () => {
    const id = newUserId();
    redisEntries.set("shared:user:" + id + ":lang", { value: "unsupported", expiresAt: Infinity });
    expect(await getUserLanguage(id)).toBe(Language.Persian);
    expect(await hasUserLanguage(id)).toBe(false);
  });
});

describe("political compass localization throughout the flow", () => {
  it.each([Language.English, Language.Russian, Language.Arabic])(
    "%s localizes every quadrant result, detail and introduction",
    async (language) => {
      const h = createBot();
      await h.callback("lang:" + language);
      const replies: string[] = [];
      const ctx = {
        from: { id: h.userId },
        reply: vi.fn(async (text: string) => {
          replies.push(text);
        }),
        replyWithPhoto: vi.fn(async (_photo: unknown, options: { caption: string }) => {
          replies.push(options.caption);
        }),
      } as unknown as Context;
      await replyAbout(ctx);
      for (const quadrant of Object.values(Quadrant)) {
        await replyResult(ctx, language, { quadrant, economicScore: 75, socialScore: -75 });
        await replyDetail(ctx, quadrant);
      }
      expect(replies).toHaveLength(11);
      const expected =
        language === Language.English ? /[A-Za-z]/ : language === Language.Russian ? /[А-Яа-я]/ : /[\u0600-\u06ff]/;
      for (const text of replies) {
        expect(text).toMatch(expected);
        if (language !== Language.Arabic) expect(text).not.toMatch(/[\u0600-\u06ff]/);
        if (language !== Language.Russian) expect(text).not.toMatch(/[А-Яа-я]/);
        expect(text).not.toMatch(/NaN|Infinity|undefined/);
      }
    },
  );
});
