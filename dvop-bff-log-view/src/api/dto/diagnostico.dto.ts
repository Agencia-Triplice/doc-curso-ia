import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class OrigemRunDto {
  @IsInt() run_id!: number;
  @IsString() @MinLength(1) @MaxLength(2048)
  @Matches(/^https?:\/\//, { message: 'html_url deve começar com http:// ou https://' })
  html_url!: string;
}

export class DiagnosticoDto {
  @IsString() @MinLength(1) @MaxLength(8192) message!: string;
  @IsOptional() @IsString() @MaxLength(256) service?: string;
  @IsOptional() @IsString() @MaxLength(64) level?: string;
  @IsOptional() @ValidateNested() @Type(() => OrigemRunDto) origem_run?: OrigemRunDto;
  @IsOptional() @IsString() @MaxLength(200) template?: string;
  @IsOptional() @IsString() @MaxLength(200) branch?: string;
}
