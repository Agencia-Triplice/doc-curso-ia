import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
export class AprovarDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20000) solucao?: string;
  @IsOptional() @IsString() @MaxLength(200) autor?: string;
  @IsOptional() @IsBoolean() publicar_base = true;
}
