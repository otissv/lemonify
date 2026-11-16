// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ValidationError } from '../errors.ts'
import { ZipWriter, openZip } from './zip.ts'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'lemonify-zip-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function writeArchive(): Promise<string> {
  const file = path.join(directory, 'bundle.zip')
  const source = path.join(directory, 'picture.bin')
  await writeFile(source, Buffer.alloc(200_000, 7))
  const writer = await ZipWriter.create(file)
  await writer.addBuffer('document.json', Buffer.from('{"a":1}'.repeat(100)))
  await writer.addFile('sources/picture', source)
  await writer.close()
  return file
}

describe('ZipWriter and openZip', () => {
  it('reads back the entries it wrote, in order', async () => {
    const archive = await openZip(await writeArchive())

    expect(archive.entries).toEqual([
      { name: 'document.json', bytes: 700 },
      { name: 'sources/picture', bytes: 200_000 },
    ])
    expect((await archive.read('document.json', 1000)).toString()).toBe(
      '{"a":1}'.repeat(100),
    )
    await archive.close()
  })

  it('extracts a file entry byte for byte', async () => {
    const archive = await openZip(await writeArchive())
    const out = path.join(directory, 'out.bin')

    await archive.extract('sources/picture', out)

    expect(await readFile(out)).toEqual(Buffer.alloc(200_000, 7))
    await archive.close()
  })

  it('compresses the JSON and stores the image as it is', async () => {
    const file = await writeArchive()
    const { size } = await import('node:fs/promises').then((fs) =>
      fs.stat(file),
    )

    expect(size).toBeGreaterThan(200_000)
    expect(size).toBeLessThan(200_000 + 700)
  })

  it('refuses an entry bigger than the limit it is asked to read', async () => {
    const archive = await openZip(await writeArchive())

    await expect(archive.read('sources/picture', 1000)).rejects.toThrow(
      ValidationError,
    )
    await archive.close()
  })

  it('notices a damaged entry', async () => {
    const file = await writeArchive()
    const bytes = await readFile(file)
    const at = bytes.indexOf(Buffer.alloc(50, 7))
    bytes[at + 10] = 8
    await writeFile(file, bytes)
    const archive = await openZip(file)

    await expect(
      archive.extract('sources/picture', path.join(directory, 'bad.bin')),
    ).rejects.toThrow(/damaged/)
    await archive.close()
  })

  it('refuses names that would leave the folder they are unpacked into', async () => {
    const writer = await ZipWriter.create(path.join(directory, 'x.zip'))

    await expect(writer.addBuffer('../evil', Buffer.from('x'))).rejects.toThrow(
      ValidationError,
    )
    await expect(writer.addBuffer('/evil', Buffer.from('x'))).rejects.toThrow(
      ValidationError,
    )
    await writer.close()
  })

  it('refuses a file that is not a zip', async () => {
    const file = path.join(directory, 'not.zip')
    await writeFile(file, 'hello')

    await expect(openZip(file)).rejects.toThrow(/not a Lemonify document/i)
  })

  it('says when an entry is missing', async () => {
    const archive = await openZip(await writeArchive())

    await expect(archive.read('nope', 10)).rejects.toThrow(/missing/)
    await archive.close()
  })

  it('refuses an archive that holds one name twice', async () => {
    const file = path.join(directory, 'twice.zip')
    const writer = await ZipWriter.create(file)
    await writer.addBuffer('same', Buffer.from('one'))
    await writer.addBuffer('same', Buffer.from('two'))
    await writer.close()

    await expect(openZip(file)).rejects.toThrow(ValidationError)
  })

  it('reports a file it cannot write instead of crashing', async () => {
    const file = path.join(directory, 'missing', 'out.zip')
    const writer = await ZipWriter.create(file)

    await expect(writer.addBuffer('a', Buffer.from('a'))).rejects.toThrow(
      /ENOENT/,
    )
    await expect(writer.abort()).resolves.toBeUndefined()
  })

  it('removes a file it did not finish when aborted', async () => {
    const file = path.join(directory, 'half.zip')
    const writer = await ZipWriter.create(file)
    await writer.addBuffer('a', Buffer.from('a'))

    await writer.abort()

    await expect(readFile(file)).rejects.toThrow(/ENOENT/)
  })

  it('refuses to unpack an entry larger than the limit it is given', async () => {
    const archive = await openZip(await writeArchive())

    await expect(
      archive.extract('sources/picture', path.join(directory, 'out'), 1000),
    ).rejects.toThrow(ValidationError)
    await archive.close()
  })
})
