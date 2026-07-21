export class AuthenticationRequiredError extends Error {
  constructor() {
    super("소셜 로그인이 필요합니다.");
    this.name = "AuthenticationRequiredError";
  }
}
