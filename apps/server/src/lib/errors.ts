export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = 'Bitte anmelden.') => new HttpError(401, message);
export const forbidden = (message = 'Keine Berechtigung.') => new HttpError(403, message);
export const notFound = (message = 'Nicht gefunden.') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
