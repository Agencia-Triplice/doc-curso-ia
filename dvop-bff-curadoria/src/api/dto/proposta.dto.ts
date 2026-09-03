import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

// corpo de POST /v1/propostas/:fingerprint e /v1/propostas/:fingerprint/regenerar —
// ambos aceitam a mesma forma: instrução livre opcional (guiança extra ao agente)
// e paths manuais opcionais (senão a seleção usa selecionarCandidatos).
export class ProporIn {
  @IsOptional() @IsString() @MaxLength(2000) instrucao?: string;
  @IsOptional() @IsArray() paths?: string[];
}
