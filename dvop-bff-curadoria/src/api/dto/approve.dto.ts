import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ApproveIn {
  // sem solucao no corpo, a aprovação usa o rascunho salvo
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20000) solucao?: string;
  @IsOptional() @IsString() @MaxLength(200) autor?: string;
  // opt-out: por padrão a aprovação também publica a curadoria na base (ms3)
  @IsOptional() @IsBoolean() publicar_base = true;
}
