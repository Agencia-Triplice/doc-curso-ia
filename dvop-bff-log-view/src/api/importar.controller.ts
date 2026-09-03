import { Body, Controller, Headers, HttpCode, HttpException, Post } from '@nestjs/common';
import { McpGithubService } from '../upstreams/mcp-github.service';
import { ImportarDto } from './dto/importar.dto';

@Controller('api')
export class ImportarController {
  constructor(private readonly mcpgh: McpGithubService) {}
  @Post('importar') @HttpCode(200)
  async importar(@Body() b: ImportarDto, @Headers('x-github-token') githubToken?: string) {
    if (!this.mcpgh.enabled) throw new HttpException({ detail: 'importação indisponível: configure LOG_BFF_MCPGH_URL' }, 503);
    return this.mcpgh.importar(b.url, githubToken);
  }
}
