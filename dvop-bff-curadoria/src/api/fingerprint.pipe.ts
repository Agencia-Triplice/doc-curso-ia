import { ArgumentMetadata, HttpException, Injectable, PipeTransform } from '@nestjs/common';

// espelha `Path(min_length=1, max_length=64)` do routes_review.py do MS 7:
// fingerprints reais têm 16 chars (sha256 truncado); 64 acomoda manuais.
@Injectable()
export class FingerprintPipe implements PipeTransform<unknown, string> {
  transform(value: unknown, _metadata: ArgumentMetadata): string {
    if (typeof value !== 'string' || value.length < 1 || value.length > 64) {
      throw new HttpException({ detail: 'fingerprint inválido (1..64)' }, 422);
    }
    return value;
  }
}
