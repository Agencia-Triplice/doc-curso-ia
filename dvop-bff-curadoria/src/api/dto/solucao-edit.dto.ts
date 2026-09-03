import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Edição de uma solução do cache: só o texto curado e o autor. A identidade
 * (fingerprint/assinatura/servico/nivel) é derivada e não se edita. */
export class SolucaoEditIn {
  @IsString() @MinLength(1) @MaxLength(20000) solucao!: string;
  @IsOptional() @IsString() @MaxLength(200) autor?: string | null;
}
