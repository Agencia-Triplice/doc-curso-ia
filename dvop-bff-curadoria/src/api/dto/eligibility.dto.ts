import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ElegibilidadeIn {
  @IsString() @MinLength(1) @MaxLength(100) remediacao_id!: string;
  @IsOptional() @IsString() @MaxLength(200) autor?: string;
  // UX obrigatória do design: sem preview exibido, sem elegibilidade — o
  // cliente declara que renderizou o preview; false ⇒ 400
  @IsOptional() @IsBoolean() preview_confirmado = false;
}
