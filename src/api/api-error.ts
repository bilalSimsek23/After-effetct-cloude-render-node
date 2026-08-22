/** Real, typed HTTP-level error from a Laravel API call — never a bare Error. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly path: string,
    public readonly responseBody: string,
  ) {
    super(`Laravel API hatası: ${statusCode} ${path} — ${responseBody.slice(0, 500)}`);
    this.name = 'ApiError';
  }
}
