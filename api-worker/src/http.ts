export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonResponse(body: unknown, init: ResponseInit = {}, origin?: string | null): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", headers.get("cache-control") ?? "no-store");
  headers.set("access-control-allow-origin", origin || "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,content-type");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function errorResponse(error: unknown, origin?: string | null): Response {
  if (error instanceof HttpError) {
    return jsonResponse(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      } satisfies ApiErrorBody,
      { status: error.status },
      origin,
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected error";
  return jsonResponse(
    {
      error: {
        code: "internal_error",
        message,
      },
    } satisfies ApiErrorBody,
    { status: 500 },
    origin,
  );
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Request body must be JSON.");
  }

  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON.");
  }
}

export function requireBearerToken(request: Request, expectedToken: string | undefined): void {
  const configuredToken = expectedToken?.trim();
  if (!configuredToken) {
    throw new HttpError(401, "admin_token_not_configured", "ADMIN_TOKEN is not configured.");
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token || token !== configuredToken) {
    throw new HttpError(401, "unauthorized", "A valid admin bearer token is required.");
  }
}
