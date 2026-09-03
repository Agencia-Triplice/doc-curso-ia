export class UpstreamError extends Error {
  constructor(public readonly statusCode: number, public readonly detail: string) {
    super(detail);
    this.name = 'UpstreamError';
  }
}
