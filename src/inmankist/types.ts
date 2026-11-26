import { Gender, Language, QuizType } from "../shared/types";

export enum QuizMode {
  SM,
  MD,
  LG,
}

export enum Value {
  A = 0,
  B,
  C,
  D,
}

export interface IUserData {
  welcomeId?: number;
  chatId?: number;
  stage?: "mode" | "gender" | "questions";
  selectionMessageId?: number;
  questionMessageIds?: Record<number, number>;
  completion?: {
    result: unknown;
    profileSaved?: boolean;
    followupDelivered?: boolean;
  };
  date: number;
  gender?: Gender;
  answers: { [i: number]: Value };
  order: number[];
  quiz: QuizType;
  mode: QuizMode;
  language?: Language;
}

export interface IQuest<T> {
  text: string;
  belong: T;
}

export interface IScore<T> {
  value: number;
  belog: T;
}
