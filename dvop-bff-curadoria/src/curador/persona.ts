import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Mapa arquétipo → persona especialista. Template fora do mapa cai no genérico. */
const PERSONAS: Record<string, string> = {
  'srv-java': 'especialista em Java/Spring (☕)',
  'bff-node': 'especialista em NestJS/Node (🟩)',
  'python-sim': 'especialista em Python (🐍)',
  'api-axway': 'especialista em API Axway (🔌)',
  'mon-ant': 'especialista em monitoração Ant/legado (📟)',
  'bat-iws': 'especialista em batch IWS (⏱)',
  'fed-node': 'especialista em front federado Node (🧩)',
};

function lerDossie(slug: string): string {
  try {
    return readFileSync(join(__dirname, 'dossies', `${slug}.md`), 'utf8');
  } catch {
    return '';
  }
}

export function resolverPersona(
  template: string | null | undefined,
): { persona: string; dossieTemplate: string } {
  const slug = (template ?? '').trim();
  if (!slug || !(slug in PERSONAS)) {
    return { persona: 'SRE sênior', dossieTemplate: '' };
  }
  return { persona: PERSONAS[slug], dossieTemplate: lerDossie(slug) };
}
