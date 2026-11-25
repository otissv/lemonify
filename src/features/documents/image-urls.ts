/** Where the browser reads images the server holds. */

export function sourceImageUrl(sourceId: string): string {
  return `/api/sources/${encodeURIComponent(sourceId)}`
}

export function previewImageUrl(documentId: string, key: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/renders/preview/${encodeURIComponent(key)}`
}

export function thumbnailImageUrl(documentId: string, key: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/renders/thumbnail/${encodeURIComponent(key)}`
}

/** The large picture of a workflow diagram node, shown beside the diagram. */
export function workflowPreviewImageUrl(
  workflowId: string,
  key: string,
): string {
  return `/api/workflows/${encodeURIComponent(workflowId)}/renders/preview/${encodeURIComponent(key)}`
}

export function workflowThumbnailImageUrl(
  workflowId: string,
  key: string,
): string {
  return `/api/workflows/${encodeURIComponent(workflowId)}/renders/workflow-node/${encodeURIComponent(key)}`
}

export function resultDownloadUrl(resultId: string): string {
  return `/api/results/${encodeURIComponent(resultId)}`
}
