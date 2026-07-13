export type SafetyCategory = "personal-info" | "sensitive" | "spam" | "ok";

export interface SafetyResult {
  safe: boolean;
  category: SafetyCategory;
  message?: string;
  showCrisisHelp?: boolean;
}

export interface SafetyProvider {
  readonly name: string;
  check(body: string, signature?: string): Promise<SafetyResult>;
}

const PERSONAL_INFO_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+(?:com|net|org|io|me|kr)\b)/i,
  /\b(?:\+?\d[\d\s().-]{7,}\d)\b/,
  /@[a-z0-9_.]{3,}/i,
  /(카톡|오픈채팅|인스타|디엠|텔레그램|디스코드|라인\s*아이디|연락\s*줘)/i,
];

const ALL_AGES_SENSITIVE_PATTERNS = [
  /(성관계|야동|음란|노출\s*사진|nudes?|porn)/i,
  /(죽여\s*버|살해|칼로\s*찌|폭탄\s*만들|테러)/i,
  /(병신|씨발|개새끼|꺼져|혐오해)/i,
];

const CRISIS_PATTERNS = [
  /(죽고\s*싶|자살|극단적\s*선택|목숨을\s*끊|self[- ]?harm|suicid)/i,
];

const SPAM_PATTERNS = [/(.)\1{7,}/u, /(광고|협찬|구매\s*문의|수익\s*보장|무료\s*쿠폰)/i];

export class ConservativeLocalSafetyProvider implements SafetyProvider {
  readonly name = "conservative-local";

  async check(body: string, signature = ""): Promise<SafetyResult> {
    const text = `${body}\n${signature}`.normalize("NFKC").trim();

    if (PERSONAL_INFO_PATTERNS.some((pattern) => pattern.test(text))) {
      return {
        safe: false,
        category: "personal-info",
        message: "연락처나 계정처럼 나를 알아볼 수 있는 정보는 병에 담을 수 없어요.",
      };
    }

    if (CRISIS_PATTERNS.some((pattern) => pattern.test(text))) {
      return {
        safe: false,
        category: "sensitive",
        message: "지금은 이 글을 띄울 수 없어요. 혼자 감당하기 어렵다면 가까운 사람이나 전문 도움에 바로 이야기해 주세요.",
        showCrisisHelp: true,
      };
    }

    if (ALL_AGES_SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
      return {
        safe: false,
        category: "sensitive",
        message: "모두가 편안히 읽을 수 있도록 표현을 조금 부드럽게 다듬어 주세요.",
      };
    }

    if (SPAM_PATTERNS.some((pattern) => pattern.test(text))) {
      return {
        safe: false,
        category: "spam",
        message: "반복 문구나 홍보성 내용은 바다에 띄울 수 없어요.",
      };
    }

    return { safe: true, category: "ok" };
  }
}

export interface TranslationProvider {
  readonly available: boolean;
  translate(text: string, targetLanguage: string): Promise<string>;
}

export class DisabledTranslationProvider implements TranslationProvider {
  readonly available = false;

  async translate(): Promise<string> {
    throw new Error("Translation requires a server-side provider.");
  }
}
