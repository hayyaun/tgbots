import { Language } from "../../shared/types";
import quadrants from "./quadrants";
import { Quadrant } from "./types";

type Info = (typeof quadrants)[string];
type Translation = Omit<Info, "emoji">;
const translated: Record<Exclude<Language, Language.Persian>, Record<Quadrant, Translation>> = {
  en: {
    auth_left: {
      name: "Authoritarian Left",
      description:
        "You favor state involvement in the economy and strong social control, with government regulating resources and maintaining order.",
      traits: [
        "Planned economy",
        "Economic equality",
        "Strong law and order",
        "Central authority",
        "State control of resources",
      ],
      examples: "Related ideas: state socialism, communism",
    },
    auth_right: {
      name: "Authoritarian Right",
      description:
        "You favor free markets alongside strong social control, with government maintaining order and traditional values.",
      traits: ["Market capitalism", "Strict law and order", "Social conservatism", "Strong authority", "Nationalism"],
      examples: "Related ideas: traditional conservatism, fascism",
    },
    lib_left: {
      name: "Libertarian Left",
      description:
        "You favor economic equality and individual freedom, combining fair distribution of wealth with civil and social liberties.",
      traits: ["Social justice", "Civil liberties", "Participatory democracy", "Environmentalism", "Human rights"],
      examples: "Related ideas: social democracy, left anarchism",
    },
    lib_right: {
      name: "Libertarian Right",
      description:
        "You favor free markets and individual freedom, with minimal government involvement in economic and social life.",
      traits: ["Free markets", "Individual liberty", "Small government", "Entrepreneurship", "Deregulation"],
      examples: "Related ideas: libertarianism, anarcho-capitalism",
    },
    center: {
      name: "Center",
      description:
        "Your position is near the center. You favor a balance between freedom and order, and between free markets and state involvement.",
      traits: ["Moderation", "Pragmatism", "Flexibility", "Problem solving", "Broad perspective"],
      examples: "Related ideas: moderate liberalism, social liberalism",
    },
  },
  ru: {
    auth_left: {
      name: "Авторитарные левые",
      description:
        "Вы поддерживаете участие государства в экономике и сильный социальный контроль, регулирование ресурсов и поддержание порядка.",
      traits: [
        "Плановая экономика",
        "Экономическое равенство",
        "Закон и порядок",
        "Центральная власть",
        "Государственное управление ресурсами",
      ],
      examples: "Близкие идеи: государственный социализм, коммунизм",
    },
    auth_right: {
      name: "Авторитарные правые",
      description:
        "Вы поддерживаете свободный рынок и сильный социальный контроль, сохранение порядка и традиционных ценностей.",
      traits: [
        "Рыночный капитализм",
        "Строгий закон и порядок",
        "Социальный консерватизм",
        "Сильная власть",
        "Национализм",
      ],
      examples: "Близкие идеи: традиционный консерватизм, фашизм",
    },
    lib_left: {
      name: "Либертарианские левые",
      description:
        "Вы поддерживаете экономическое равенство и личную свободу, справедливое распределение богатства и гражданские права.",
      traits: [
        "Социальная справедливость",
        "Гражданские свободы",
        "Демократия участия",
        "Защита окружающей среды",
        "Права человека",
      ],
      examples: "Близкие идеи: социал-демократия, левый анархизм",
    },
    lib_right: {
      name: "Либертарианские правые",
      description:
        "Вы поддерживаете свободный рынок и личную свободу при минимальном участии государства в экономике и общественной жизни.",
      traits: ["Свободный рынок", "Личная свобода", "Малое государство", "Предпринимательство", "Дерегулирование"],
      examples: "Близкие идеи: либертарианство, анархо-капитализм",
    },
    center: {
      name: "Центр",
      description:
        "Ваша позиция близка к центру. Вы поддерживаете баланс свободы и порядка, свободного рынка и государственного участия.",
      traits: ["Умеренность", "Прагматизм", "Гибкость", "Решение проблем", "Широкий взгляд"],
      examples: "Близкие идеи: умеренный либерализм, социальный либерализм",
    },
  },
  ar: {
    auth_left: {
      name: "اليسار الاستبدادي",
      description: "تؤيد تدخل الدولة في الاقتصاد والرقابة الاجتماعية القوية، مع تنظيم الموارد والحفاظ على النظام.",
      traits: ["اقتصاد مخطط", "مساواة اقتصادية", "قانون ونظام قويان", "سلطة مركزية", "إدارة الدولة للموارد"],
      examples: "أفكار قريبة: اشتراكية الدولة، الشيوعية",
    },
    auth_right: {
      name: "اليمين الاستبدادي",
      description: "تؤيد السوق الحرة مع الرقابة الاجتماعية القوية والحفاظ على النظام والقيم التقليدية.",
      traits: ["رأسمالية السوق", "قانون ونظام صارمان", "محافظة اجتماعية", "سلطة قوية", "قومية"],
      examples: "أفكار قريبة: المحافظة التقليدية، الفاشية",
    },
    lib_left: {
      name: "اليسار التحرري",
      description: "تؤيد المساواة الاقتصادية والحرية الفردية، مع توزيع عادل للثروة وحريات مدنية واجتماعية واسعة.",
      traits: ["عدالة اجتماعية", "حريات مدنية", "ديمقراطية تشاركية", "حماية البيئة", "حقوق الإنسان"],
      examples: "أفكار قريبة: الديمقراطية الاجتماعية، الأناركية اليسارية",
    },
    lib_right: {
      name: "اليمين التحرري",
      description: "تؤيد السوق الحرة والحرية الفردية، مع أقل تدخل حكومي في الاقتصاد والحياة الاجتماعية.",
      traits: ["سوق حرة", "حرية فردية", "حكومة صغيرة", "ريادة الأعمال", "تقليل القيود التنظيمية"],
      examples: "أفكار قريبة: الليبرتارية، الرأسمالية الأناركية",
    },
    center: {
      name: "الوسط",
      description: "يقع موقفك قرب الوسط. تؤيد التوازن بين الحرية والنظام، وبين السوق الحرة وتدخل الدولة.",
      traits: ["اعتدال", "براغماتية", "مرونة", "حل المشكلات", "نظرة شاملة"],
      examples: "أفكار قريبة: الليبرالية المعتدلة، الليبرالية الاجتماعية",
    },
  },
};

export function getQuadrant(key: Quadrant, language: Language): Info {
  const original = quadrants[key];
  return language === Language.Persian || !original ? original : { ...original, ...translated[language][key] };
}

export const labels = {
  fa: {
    about:
      "قطب‌نمای سیاسی دیدگاه‌های سیاسی شما را در دو محور اندازه‌گیری می‌کند:\n\n📊 محور اقتصادی: چپ (دخالت دولت) ↔ راست (بازار آزاد)\n🏛️ محور اجتماعی: اقتدارگرا (نظم) ↔ آزادی‌خواه (آزادی)\n\nاین آزمون تمایلات فکری را می‌سنجد و قضاوت اخلاقی نیست.",
    traits: "ویژگی‌ها",
    position: "موقعیت شما",
    economic: "اقتصادی",
    social: "اجتماعی",
    center: "میانه",
    strongLeft: "چپ قوی",
    left: "چپ میانه",
    strongRight: "راست قوی",
    right: "راست میانه",
    strongAuth: "اقتدارگرای قوی",
    auth: "اقتدارگرای میانه",
    strongLib: "آزادی‌خواه قوی",
    lib: "آزادی‌خواه میانه",
  },
  en: {
    about:
      "The political compass describes your views on two axes:\n\nEconomic: left (state involvement) ↔ right (free markets)\nSocial: authoritarian (order) ↔ libertarian (freedom)\n\nThis test describes preferences; it is not a moral judgment.",
    traits: "Traits",
    position: "Your position",
    economic: "Economic",
    social: "Social",
    center: "Center",
    strongLeft: "Strong left",
    left: "Moderate left",
    strongRight: "Strong right",
    right: "Moderate right",
    strongAuth: "Strong authoritarian",
    auth: "Moderate authoritarian",
    strongLib: "Strong libertarian",
    lib: "Moderate libertarian",
  },
  ru: {
    about:
      "Политический компас описывает ваши взгляды по двум осям:\n\nЭкономика: левые (участие государства) ↔ правые (свободный рынок)\nОбщество: авторитаризм (порядок) ↔ либертарианство (свобода)\n\nТест описывает предпочтения и не является моральной оценкой.",
    traits: "Черты",
    position: "Ваша позиция",
    economic: "Экономика",
    social: "Общество",
    center: "Центр",
    strongLeft: "Выраженные левые",
    left: "Умеренные левые",
    strongRight: "Выраженные правые",
    right: "Умеренные правые",
    strongAuth: "Выраженный авторитаризм",
    auth: "Умеренный авторитаризм",
    strongLib: "Выраженное либертарианство",
    lib: "Умеренное либертарианство",
  },
  ar: {
    about:
      "تصف البوصلة السياسية آراءك على محورين:\n\nالاقتصاد: اليسار (تدخل الدولة) ↔ اليمين (السوق الحرة)\nالمجتمع: الاستبداد (النظام) ↔ التحرر (الحرية)\n\nيصف هذا الاختبار التفضيلات ولا يقدم حكما أخلاقيا.",
    traits: "السمات",
    position: "موقعك",
    economic: "الاقتصاد",
    social: "المجتمع",
    center: "الوسط",
    strongLeft: "يسار قوي",
    left: "يسار معتدل",
    strongRight: "يمين قوي",
    right: "يمين معتدل",
    strongAuth: "استبداد قوي",
    auth: "استبداد معتدل",
    strongLib: "تحرر قوي",
    lib: "تحرر معتدل",
  },
};
