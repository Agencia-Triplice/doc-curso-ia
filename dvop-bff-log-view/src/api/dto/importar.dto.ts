import { IsString, MaxLength, MinLength } from 'class-validator';
export class ImportarDto { @IsString() @MinLength(1) @MaxLength(512) url!: string; }
