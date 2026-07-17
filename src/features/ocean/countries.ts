import type { SeaId } from "@/features/ocean/types/ocean";
import { localeForLanguage, type LanguageCode } from "@/i18n/languages";
import { translate } from "@/i18n/i18n";

export interface CountryOption {
  code: string;
  name: string;
  recommendedSeaId: SeaId;
}

export const COUNTRY_OPTIONS: readonly CountryOption[] = [
  { code: "KR", name: "대한민국", recommendedSeaId: "pacific" },
  { code: "JP", name: "일본", recommendedSeaId: "pacific" },
  { code: "CN", name: "중국", recommendedSeaId: "pacific" },
  { code: "TW", name: "대만", recommendedSeaId: "pacific" },
  { code: "HK", name: "홍콩", recommendedSeaId: "pacific" },
  { code: "MN", name: "몽골", recommendedSeaId: "pacific" },
  { code: "VN", name: "베트남", recommendedSeaId: "pacific" },
  { code: "PH", name: "필리핀", recommendedSeaId: "pacific" },
  { code: "ID", name: "인도네시아", recommendedSeaId: "pacific" },
  { code: "AU", name: "오스트레일리아", recommendedSeaId: "pacific" },
  { code: "NZ", name: "뉴질랜드", recommendedSeaId: "pacific" },
  { code: "FJ", name: "피지", recommendedSeaId: "pacific" },
  { code: "IN", name: "인도", recommendedSeaId: "indian" },
  { code: "PK", name: "파키스탄", recommendedSeaId: "indian" },
  { code: "BD", name: "방글라데시", recommendedSeaId: "indian" },
  { code: "LK", name: "스리랑카", recommendedSeaId: "indian" },
  { code: "TH", name: "태국", recommendedSeaId: "indian" },
  { code: "MY", name: "말레이시아", recommendedSeaId: "indian" },
  { code: "SG", name: "싱가포르", recommendedSeaId: "indian" },
  { code: "AE", name: "아랍에미리트", recommendedSeaId: "indian" },
  { code: "SA", name: "사우디아라비아", recommendedSeaId: "indian" },
  { code: "OM", name: "오만", recommendedSeaId: "indian" },
  { code: "KE", name: "케냐", recommendedSeaId: "indian" },
  { code: "TZ", name: "탄자니아", recommendedSeaId: "indian" },
  { code: "ZA", name: "남아프리카 공화국", recommendedSeaId: "indian" },
  { code: "US", name: "미국", recommendedSeaId: "atlantic" },
  { code: "CA", name: "캐나다", recommendedSeaId: "atlantic" },
  { code: "MX", name: "멕시코", recommendedSeaId: "atlantic" },
  { code: "BR", name: "브라질", recommendedSeaId: "atlantic" },
  { code: "AR", name: "아르헨티나", recommendedSeaId: "atlantic" },
  { code: "CL", name: "칠레", recommendedSeaId: "pacific" },
  { code: "PE", name: "페루", recommendedSeaId: "pacific" },
  { code: "CO", name: "콜롬비아", recommendedSeaId: "atlantic" },
  { code: "GB", name: "영국", recommendedSeaId: "atlantic" },
  { code: "IE", name: "아일랜드", recommendedSeaId: "atlantic" },
  { code: "FR", name: "프랑스", recommendedSeaId: "atlantic" },
  { code: "ES", name: "스페인", recommendedSeaId: "atlantic" },
  { code: "PT", name: "포르투갈", recommendedSeaId: "atlantic" },
  { code: "DE", name: "독일", recommendedSeaId: "atlantic" },
  { code: "NL", name: "네덜란드", recommendedSeaId: "atlantic" },
  { code: "BE", name: "벨기에", recommendedSeaId: "atlantic" },
  { code: "IT", name: "이탈리아", recommendedSeaId: "atlantic" },
  { code: "GR", name: "그리스", recommendedSeaId: "atlantic" },
  { code: "TR", name: "튀르키예", recommendedSeaId: "atlantic" },
  { code: "MA", name: "모로코", recommendedSeaId: "atlantic" },
  { code: "NG", name: "나이지리아", recommendedSeaId: "atlantic" },
  { code: "GH", name: "가나", recommendedSeaId: "atlantic" },
  { code: "NO", name: "노르웨이", recommendedSeaId: "arctic" },
  { code: "SE", name: "스웨덴", recommendedSeaId: "arctic" },
  { code: "FI", name: "핀란드", recommendedSeaId: "arctic" },
  { code: "IS", name: "아이슬란드", recommendedSeaId: "arctic" },
  { code: "GL", name: "그린란드", recommendedSeaId: "arctic" },
  { code: "RU", name: "러시아", recommendedSeaId: "arctic" },
  { code: "AQ", name: "남극", recommendedSeaId: "southern" },
  { code: "ZZ", name: "기타 국가", recommendedSeaId: "pacific" },
];

const COUNTRY_BY_CODE = new Map(COUNTRY_OPTIONS.map((country) => [country.code, country]));

const TIME_ZONE_COUNTRY_CODES: Record<string, string> = {
  "Asia/Seoul": "KR",
  "Asia/Tokyo": "JP",
  "Asia/Shanghai": "CN",
  "Asia/Taipei": "TW",
  "Asia/Ho_Chi_Minh": "VN",
  "Asia/Kolkata": "IN",
  "Asia/Singapore": "SG",
  "Australia/Sydney": "AU",
  "Pacific/Auckland": "NZ",
  "America/New_York": "US",
  "Europe/London": "GB",
  "Europe/Paris": "FR",
};

export const countryName = (countryCode?: string | null, languageCode: LanguageCode = "ko"): string => {
  if (!countryCode) return translate(languageCode, "country.unknown");
  const normalized = countryCode.toUpperCase();
  if (normalized === "ZZ") return translate(languageCode, "country.other");
  try {
    return new Intl.DisplayNames([localeForLanguage(languageCode)], { type: "region" }).of(normalized)
      ?? COUNTRY_BY_CODE.get(normalized)?.name
      ?? normalized;
  } catch {
    return COUNTRY_BY_CODE.get(normalized)?.name ?? normalized;
  }
};

export const recommendedSeaForCountry = (countryCode?: string | null): SeaId =>
  COUNTRY_BY_CODE.get(countryCode?.toUpperCase() ?? "")?.recommendedSeaId ?? "pacific";

export const suggestedCountryCode = (): string => {
  const localeRegion = navigator.languages
    .map((locale) => locale.match(/[-_]([A-Z]{2})$/i)?.[1]?.toUpperCase())
    .find((countryCode): countryCode is string => Boolean(countryCode && COUNTRY_BY_CODE.has(countryCode)));

  if (localeRegion) return localeRegion;

  return TIME_ZONE_COUNTRY_CODES[Intl.DateTimeFormat().resolvedOptions().timeZone] ?? "KR";
};
