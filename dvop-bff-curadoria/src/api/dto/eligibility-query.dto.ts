import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class EligibilityQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit = 100;
}
