export const DRAFT_LENGTH_ERROR = "편지는 10자 이상 1,000자 이하로 적어 주세요.";

export const hasValidDraft = (body: string, signature: string): boolean => {
  const bodyLength = Array.from(body).length;
  const trimmedBodyLength = Array.from(body.trim()).length;
  return trimmedBodyLength >= 10 && bodyLength <= 1000 && signature.length <= 20;
};
