import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class LogsQueryDto {
  @IsString() src!: string;
  @IsOptional() @IsString() @MaxLength(20) level?: string;
  @IsOptional() @IsString() @MaxLength(256) service?: string;
  @IsOptional() @IsString() @MaxLength(512) q?: string;
  @IsOptional() @IsString() @MaxLength(40) since?: string;
  @IsOptional() @IsString() @MaxLength(40) until?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}
