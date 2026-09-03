export function logJson(level: string, message: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(), logger: 'dvop-bff-log-view', message, ...extra,
  }) + '\n');
}
