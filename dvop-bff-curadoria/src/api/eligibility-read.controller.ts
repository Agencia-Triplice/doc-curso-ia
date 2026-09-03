/**
 * Leitura pública do vínculo de elegibilidade (fingerprint→remediação).
 *
 * Esta é a ÚNICA rota da elegibilidade fora do AuthGuard, e de propósito: quem
 * a consome é o MS 8 (dvop-srv-remediation, ElegibilidadeClient) numa chamada
 * serviço-a-serviço SEM sessão de humano. Sob o guard, o executor recebia 401,
 * o cliente traduzia para CuradoriaIndisponivel e o evento terminava em
 * 'erro_curadoria' — o PR automático nunca abria. O dado é só-leitura e
 * não-sensível (id/versão/serviço da remediação já escolhida no preview).
 *
 * As ações de curadoria (aprovar, atrelar via PUT, listar, remover) continuam
 * gated na EligibilityController.
 */
import { Controller, Get, HttpException, Param } from '@nestjs/common';
import { EligibilityStore } from '../eligibility/eligibility-store.service';
import { FingerprintPipe } from './fingerprint.pipe';

@Controller('v1')
export class EligibilityReadController {
  constructor(private readonly store: EligibilityStore) {}

  @Get('elegibilidade/:fingerprint')
  getElegibilidade(@Param('fingerprint', FingerprintPipe) fingerprint: string) {
    const row = this.store.get(fingerprint);
    if (!row) {
      throw new HttpException({ detail: 'sem elegibilidade para este fingerprint' }, 404);
    }
    return row;
  }
}
