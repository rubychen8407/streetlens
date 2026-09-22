export function getAssessmentSnapshotStatus(
  sourceKeys: string[],
  snapshots: Record<string, { status?: string } | null | undefined>,
): { missingSources: string[]; dataStatus: "pending_refresh" | "cached" } {
  const missingSources = sourceKeys.filter((key) => !snapshots[key]);
  return {
    missingSources,
    dataStatus: missingSources.length === sourceKeys.length ? "pending_refresh" : "cached",
  };
}
