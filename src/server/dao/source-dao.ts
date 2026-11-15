export type SourceRecord = {
  id: string
  ownerId: string
  contentHash: string
  fileName: string
  mediaType: string
  bytes: number
  width: number
  height: number
  createdAt: string
}

export interface SourceDao {
  /**
   * Stores the Source, or returns the User's existing one with the same
   * content hash, so the same image uploaded twice is one Source.
   */
  insert(
    source: SourceRecord,
  ): Promise<{ source: SourceRecord; created: boolean }>
  findById(id: string): Promise<SourceRecord | null>
  /** Newest first. */
  listByOwner(ownerId: string): Promise<SourceRecord[]>
  /** Whether a Document uses the Source as its image or as a second image. */
  isReferenced(sourceId: string): Promise<boolean>
  /** Refused by the database while a Document uses the Source. */
  delete(id: string): Promise<void>
  /** How many Sources, of any User, share the content hash (and so the file). */
  countByHash(contentHash: string): Promise<number>
}
