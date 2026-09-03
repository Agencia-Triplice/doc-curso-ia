import { IsString, Length } from 'class-validator';

export class PatIn {
  // PATs do GitHub variam de tamanho (clássicos ~40, fine-grained ~90+).
  // Length generoso só barra vazio e lixo absurdo; a validação real é no GitHub.
  @IsString()
  @Length(1, 255)
  token!: string;
}
