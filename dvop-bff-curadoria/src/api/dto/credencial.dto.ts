import { IsString, MaxLength, MinLength } from 'class-validator';

export class CredencialDto {
  // mesmo teto do github_token do cockpit e do CredencialIn do MS 8
  @IsString() @MinLength(1) @MaxLength(512) token!: string;
}
