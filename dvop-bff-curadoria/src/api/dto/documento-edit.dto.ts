import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Edição de um documento da base. A origem do erro é procedência e não se edita. */
export class DocumentoEditIn {
  @IsString() @MinLength(1) @MaxLength(300) titulo!: string;
  @IsString() @MinLength(1) @MaxLength(20000) conteudo!: string;
  @IsOptional() @IsString() @MaxLength(200) servico?: string | null;
  @IsOptional() @IsString() @MaxLength(20) nivel?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(64, { each: true }) tags?: string[];
}
