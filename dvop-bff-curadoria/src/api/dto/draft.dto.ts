import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DraftIn {
  @IsString() @MinLength(1) @MaxLength(20000) solucao!: string;
  @IsOptional() @IsString() @MaxLength(200) autor?: string;
}
