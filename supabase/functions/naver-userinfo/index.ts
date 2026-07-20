const json = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

interface NaverProfileResponse {
  resultcode?: string;
  message?: string;
  response?: {
    id?: string;
    email?: string;
    name?: string;
    nickname?: string;
    profile_image?: string;
  };
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization) || authorization.length > 4096) {
    return json({ error: "NAVER_TOKEN_REQUIRED" }, 401);
  }

  try {
    const response = await fetch("https://openapi.naver.com/v1/nid/me", {
      headers: { Authorization: authorization },
    });
    const profile = await response.json() as NaverProfileResponse;
    const user = profile.response;

    if (!response.ok || profile.resultcode !== "00" || !user?.id) {
      return json({ error: "NAVER_PROFILE_FAILED" }, response.status >= 400 ? response.status : 502);
    }

    return json({
      sub: user.id,
      ...(user.email ? { email: user.email, email_verified: true } : {}),
      ...(user.name || user.nickname ? { name: user.name ?? user.nickname } : {}),
      ...(user.nickname ? { preferred_username: user.nickname } : {}),
      ...(user.profile_image ? { picture: user.profile_image } : {}),
    });
  } catch {
    return json({ error: "NAVER_PROFILE_UNAVAILABLE" }, 502);
  }
});
