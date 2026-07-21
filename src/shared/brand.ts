export const HERO_IMAGE = `${import.meta.env.BASE_URL}assets/doongdoong-ocean-hero.jpg`;
export const BEACH_IMAGE = `${import.meta.env.BASE_URL}assets/doongdoong-beach-empty.jpg`;
// The login image is the LCP candidate on mobile. Keep a purpose-sized source
// for that route instead of downloading the 1536px scene for a 412px viewport.
export const LOGIN_BEACH_IMAGE = `${import.meta.env.BASE_URL}assets/doongdoong-beach-empty-lcp.jpg`;
export const WRITING_SET_IMAGE = `${import.meta.env.BASE_URL}assets/doongdoong-writing-set.png`;
export const BOTTLE_WITH_LETTER_IMAGE = `${import.meta.env.BASE_URL}assets/doongdoong-bottle-letter.png`;
export const ARRIVED_BOTTLE_IMAGE = `${import.meta.env.BASE_URL}assets/doongdoong-bottle-arrived.png`;
export const EMPTY_BOTTLE_IMAGE = `${import.meta.env.BASE_URL}assets/doongdoong-bottle-empty.png`;
export const KEEPSAKE_IMAGE = `${import.meta.env.BASE_URL}assets/doongdoong-keepsake.png`;
export const GUIDE_SIGN_IMAGE = `${import.meta.env.BASE_URL}assets/doongdoong-guide-sign.png`;
export const SEAGULL_IMAGE = `${import.meta.env.BASE_URL}assets/doongdoong-seagull.png`;
export const CRAB_IMAGE = `${import.meta.env.BASE_URL}assets/doongdoong-crab.png`;

export const SEA_LABELS = {
  pacific: "태평양",
  atlantic: "대서양",
  indian: "인도양",
  arctic: "북극해",
  southern: "남극해",
} as const;
