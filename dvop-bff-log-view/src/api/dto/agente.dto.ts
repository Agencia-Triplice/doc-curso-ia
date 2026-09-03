import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AgenteDiagnosticoDto {
  @IsString() @MinLength(1) @MaxLength(8192) message!: string;
  @IsOptional() @IsString() @MaxLength(200) service?: string;
  @IsOptional() @IsString() @MaxLength(50) level?: string;
  @IsOptional() @IsString() @MaxLength(100) template?: string;
  @IsOptional() @IsString() @MaxLength(64) fingerprint?: string;
}
