import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DiagnosticoMistoDto {
  @IsString() @MinLength(1) @MaxLength(16384) message!: string;
  @IsOptional() @IsString() @MaxLength(512) github_token?: string;
}
