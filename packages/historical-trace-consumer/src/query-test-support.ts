import type { HistoricalGatewayOperationExecutor, HistoricalQueryRequest, HistoricalQueryResult } from './executor.js';
/** Domain-only fixture adapter. Real snapshot boundaries are tested separately. */
export async function historicalQueryFixture(gateway: Pick<HistoricalGatewayOperationExecutor, 'execute'>, request: HistoricalQueryRequest): Promise<HistoricalQueryResult> {
  const interval = await gateway.execute('operational-task.get-execution-intervals', request.operationInput) as Record<string, unknown>;
  const selected = (interval['intervals'] as Array<Record<string, unknown>> | undefined)?.[0];
  if (request.pattern === 'HISTORICAL_EXECUTION_INTERVAL' || !selected?.['executionIntervalReferenceKey'] || !['COMPLETED', 'PARTIAL'].includes(String(interval['status']))) return { interval };
  const trajectory = await gateway.execute('history.get-trajectory', { ...request.parameterValues, executionIntervalReferenceKey: selected['executionIntervalReferenceKey'] });
  return { interval, trajectory };
}
