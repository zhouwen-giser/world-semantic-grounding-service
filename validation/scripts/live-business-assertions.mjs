/** Domain assertions are separate from HTTP/schema/persistence checks. */
export function evaluateLiveBusinessCase(name, result, executions = [], expectation = 'POSITIVE_BUSINESS') {
  const findings = result.worldAnalysisFindings?.findings ?? [];
  const evidence = result.evidenceItems ?? [];
  const usable = kind => findings.filter(finding => finding.findingKind === kind && ['COMPLETED', 'PARTIAL'].includes(finding.status));
  const operation = id => evidence.some(item => item.sourceOperation?.split('@')[0] === id && ['COMPLETED', 'PARTIAL'].includes(item.upstreamStatus));
  const trace = usable('HISTORICAL_TRACE').some(finding => finding.coverage?.sampleCount > 0 && finding.subjectReferenceProductIds?.length > 0);
  const providerNoData = executions.some(entry => entry.operation_id === 'landcover.get-class' && entry.upstream_status === 'NO_DATA' && entry.receipt_count > 0);
  const publicNoData = evidence.some(item => item.sourceOperation?.split('@')[0] === 'landcover.get-class' && item.upstreamStatus === 'NO_DATA' && item.receiptIds?.length > 0 && item.unknowns?.includes('NO_DATA'));
  if (expectation === 'NO_DATA_PROPAGATION') {
    if (name !== 'GDPS') throw new Error('NO_DATA_EXPECTATION_REQUIRES_GDPS');
    return { expectation, passed: providerNoData && publicNoData, businessStatus: 'NOT_PROVEN', providerNoData, publicNoData };
  }
  if (expectation !== 'POSITIVE_BUSINESS') throw new Error('UNKNOWN_BUSINESS_EXPECTATION');
  const positive = name === 'BASIC' ? result.referenceProducts?.length > 0 && evidence.some(item => ['COMPLETED', 'PARTIAL'].includes(item.upstreamStatus)) :
    name === 'TRACE' ? trace && operation('history.get-trajectory') :
    name === 'MAP' ? trace && operation('trajectory.map-match') && usable('ROAD_ASSOCIATION').some(finding => finding.roadVisits?.length > 0) :
    name === 'STOP' ? trace && operation('temporal-spatial.find-events') && usable('TEMPORAL_EVENT').some(finding => finding.events?.some(event => event.eventType === 'STOP')) :
    name === 'CROSS' ? trace && operation('trajectory.map-match') && operation('temporal-spatial.find-events') && usable('ROAD_ASSOCIATION').length > 0 &&
      usable('TEMPORAL_EVENT').some(finding => finding.events?.some(event => event.eventType === 'CROSS')) :
    name === 'RANK' ? trace && operation('spatiotemporal-metric.rank-locations') && usable('METRIC_RANKING').some(finding => finding.candidates?.length > 0 && finding.candidateDomain === 'PAST_OBSERVED_LOCATIONS') :
    name === 'GDPS' ? operation('landcover.get-class') && result.geospatialFindings?.findings?.some(finding => ['COMPLETED', 'PARTIAL'].includes(finding.status)) : false;
  const gaps = [...(result.worldAnalysisFindings?.gaps ?? []), ...(result.geospatialFindings?.gaps ?? []), ...(result.capabilityGaps ?? [])];
  const passed = Boolean(positive) && !gaps.some(gap => gap.severity === 'BLOCKING' || gap.blocking === true);
  const partial = result.status === 'PARTIAL' || findings.some(finding => finding.status === 'PARTIAL' || finding.selection?.confirmed === false);
  return { expectation, passed, businessStatus: passed ? partial ? 'PARTIAL' : 'PASS' : 'NOT_PROVEN',
    reasonCodes: passed ? [] : ['POSITIVE_BUSINESS_RESULT_NOT_PROVEN'],
    ...(name === 'GDPS' ? { providerNoData, publicNoData } : {}) };
}
