import { describe, expect, it } from 'vitest'

import {
  LibraryRequestKind,
  describeLibraryRequest,
} from '@/features/library/library-request'

describe('describeLibraryRequest', () => {
  it('names opening a library image, with no upload since Open image covers it', () => {
    expect(describeLibraryRequest({ kind: LibraryRequestKind.Open })).toEqual({
      title: 'Open library image',
      description: 'Open a new document on an image from your library.',
    })
  })

  it('names inserting an image, and offers an upload', () => {
    expect(
      describeLibraryRequest({
        kind: LibraryRequestKind.Insert,
        documentId: 'd1',
      }),
    ).toMatchObject({
      title: 'Insert image',
      uploadLabel: 'Upload from computer…',
    })
  })

  it('names replacing an image, and offers an upload', () => {
    expect(
      describeLibraryRequest({
        kind: LibraryRequestKind.Replace,
        documentId: 'd1',
      }),
    ).toMatchObject({
      title: 'Replace image',
      uploadLabel: 'Upload from computer…',
    })
  })
})
