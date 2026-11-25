import { createReadStream, createWriteStream } from 'node:fs'
import { open, rm, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import type { Writable } from 'node:stream'
import {
  constants,
  crc32,
  createInflateRaw,
  deflateRawSync,
  inflateRawSync,
} from 'node:zlib'

import { LimitError, ValidationError } from '../errors.ts'

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const VERSION = 20
const UTF8_NAMES = 0x0800
const ENCRYPTED = 0x0001
const DATA_DESCRIPTOR = 0x0008
const STORED = 0
const DEFLATED = 8
const FIXED_DATE = 0x21
const FIXED_TIME = 0
const MAX_BYTES = 0xffffffff
const MAX_ENTRIES = 0xffff
const LOCAL_HEADER_BYTES = 30
const CENTRAL_HEADER_BYTES = 46
const END_RECORD_BYTES = 22
const MAX_COMMENT_BYTES = 0xffff
const NOT_A_BUNDLE = 'That file is not a Lemonify document.'
const DAMAGED = 'The document file is damaged.'
const TOO_BIG = 'The document is too large to be stored in one file.'

export interface ZipEntryInfo {
  name: string
  bytes: number
}

interface WrittenEntry {
  name: Buffer
  method: number
  crc: number
  compressed: number
  size: number
  offset: number
}

function checkName(name: string): Buffer {
  const parts = name.split('/')
  const unsafe =
    name === '' ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  if (unsafe) throw new ValidationError(`"${name}" is not a safe file name.`)
  return Buffer.from(name, 'utf8')
}

function localHeader(entry: WrittenEntry): Buffer {
  const header = Buffer.alloc(LOCAL_HEADER_BYTES)
  header.writeUInt32LE(LOCAL_SIGNATURE, 0)
  header.writeUInt16LE(VERSION, 4)
  header.writeUInt16LE(UTF8_NAMES, 6)
  header.writeUInt16LE(entry.method, 8)
  header.writeUInt16LE(FIXED_TIME, 10)
  header.writeUInt16LE(FIXED_DATE, 12)
  header.writeUInt32LE(entry.crc, 14)
  header.writeUInt32LE(entry.compressed, 18)
  header.writeUInt32LE(entry.size, 22)
  header.writeUInt16LE(entry.name.length, 26)
  header.writeUInt16LE(0, 28)
  return header
}

function centralHeader(entry: WrittenEntry): Buffer {
  const header = Buffer.alloc(CENTRAL_HEADER_BYTES)
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0)
  header.writeUInt16LE(VERSION, 4)
  header.writeUInt16LE(VERSION, 6)
  header.writeUInt16LE(UTF8_NAMES, 8)
  header.writeUInt16LE(entry.method, 10)
  header.writeUInt16LE(FIXED_TIME, 12)
  header.writeUInt16LE(FIXED_DATE, 14)
  header.writeUInt32LE(entry.crc, 16)
  header.writeUInt32LE(entry.compressed, 20)
  header.writeUInt32LE(entry.size, 24)
  header.writeUInt16LE(entry.name.length, 28)
  header.writeUInt32LE(entry.offset, 42)
  return header
}

async function fileCrc(file: string): Promise<number> {
  let crc = 0
  for await (const chunk of createReadStream(file)) {
    crc = crc32(chunk as Buffer, crc)
  }
  return crc
}

function endWrite(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once('error', reject)
    stream.end(resolve)
  })
}

function writeChunk(stream: Writable, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

/**
 * Writes a zip file entry by entry. Files are stored as they are (images are
 * already compressed); buffers such as the manifest are deflated. Entry times
 * are fixed, so the same content always makes the same file.
 */
export class ZipWriter {
  readonly #file: string
  readonly #stream: Writable
  readonly #tooBig: string
  readonly #entries: WrittenEntry[] = []
  #offset = 0

  private constructor(file: string, stream: Writable, tooBig: string) {
    this.#file = file
    this.#stream = stream
    this.#tooBig = tooBig
    // A failed write reaches the caller through the write that failed; this
    // keeps the same error from also being thrown where nobody can catch it.
    stream.on('error', () => {})
  }

  /** `tooBig` is what a file past the zip format's limits is refused with, naming what was being written. */
  static async create(file: string, tooBig = TOO_BIG): Promise<ZipWriter> {
    return new ZipWriter(file, createWriteStream(file), tooBig)
  }

  /** Gives up on the file: closes it and removes what was written. Safe to call after a failure. */
  async abort(): Promise<void> {
    this.#stream.destroy()
    await rm(this.#file, { force: true })
  }

  async #begin(entry: WrittenEntry): Promise<void> {
    if (this.#entries.length >= MAX_ENTRIES) {
      throw new LimitError(this.#tooBig)
    }
    if (entry.offset > MAX_BYTES) throw new LimitError(this.#tooBig)
    await writeChunk(this.#stream, localHeader(entry))
    await writeChunk(this.#stream, entry.name)
    this.#offset += LOCAL_HEADER_BYTES + entry.name.length
  }

  /** Adds a small entry from memory, deflated. */
  async addBuffer(name: string, data: Buffer): Promise<void> {
    const packed = deflateRawSync(data, { level: constants.Z_BEST_COMPRESSION })
    const entry: WrittenEntry = {
      name: checkName(name),
      method: DEFLATED,
      crc: crc32(data),
      compressed: packed.length,
      size: data.length,
      offset: this.#offset,
    }
    if (data.length > MAX_BYTES) throw new LimitError(this.#tooBig)
    await this.#begin(entry)
    await writeChunk(this.#stream, packed)
    this.#offset += packed.length
    this.#entries.push(entry)
  }

  /** Adds a file from disk as it is, without compressing it. */
  async addFile(name: string, file: string): Promise<void> {
    const { size } = await stat(file)
    if (size > MAX_BYTES) throw new LimitError(this.#tooBig)
    const entry: WrittenEntry = {
      name: checkName(name),
      method: STORED,
      crc: await fileCrc(file),
      compressed: size,
      size,
      offset: this.#offset,
    }
    await this.#begin(entry)
    for await (const chunk of createReadStream(file)) {
      await writeChunk(this.#stream, chunk as Buffer)
    }
    this.#offset += size
    this.#entries.push(entry)
  }

  /** Writes the index and closes the file. */
  async close(): Promise<void> {
    const start = this.#offset
    let size = 0
    for (const entry of this.#entries) {
      const header = centralHeader(entry)
      await writeChunk(this.#stream, header)
      await writeChunk(this.#stream, entry.name)
      size += header.length + entry.name.length
    }
    const end = Buffer.alloc(END_RECORD_BYTES)
    end.writeUInt32LE(END_SIGNATURE, 0)
    end.writeUInt16LE(this.#entries.length, 8)
    end.writeUInt16LE(this.#entries.length, 10)
    end.writeUInt32LE(size, 12)
    end.writeUInt32LE(start, 16)
    await writeChunk(this.#stream, end)
    await endWrite(this.#stream)
  }
}

interface IndexedEntry {
  name: string
  method: number
  crc: number
  compressed: number
  size: number
  offset: number
}

async function readAt(
  handle: FileHandle,
  position: number,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buffer, 0, length, position)
  if (bytesRead !== length) throw new ValidationError(NOT_A_BUNDLE)
  return buffer
}

function endRecordOffset(tail: Buffer): number {
  for (let at = tail.length - END_RECORD_BYTES; at >= 0; at--) {
    if (tail.readUInt32LE(at) === END_SIGNATURE) return at
  }
  throw new ValidationError(NOT_A_BUNDLE)
}

function parseCentral(directory: Buffer, count: number): IndexedEntry[] {
  const entries: IndexedEntry[] = []
  let at = 0
  for (let index = 0; index < count; index++) {
    if (
      at + CENTRAL_HEADER_BYTES > directory.length ||
      directory.readUInt32LE(at) !== CENTRAL_SIGNATURE
    ) {
      throw new ValidationError(NOT_A_BUNDLE)
    }
    const flags = directory.readUInt16LE(at + 8)
    const nameLength = directory.readUInt16LE(at + 28)
    const extraLength = directory.readUInt16LE(at + 30)
    const commentLength = directory.readUInt16LE(at + 32)
    const name = directory
      .subarray(
        at + CENTRAL_HEADER_BYTES,
        at + CENTRAL_HEADER_BYTES + nameLength,
      )
      .toString('utf8')
    if (flags & (ENCRYPTED | DATA_DESCRIPTOR)) {
      throw new ValidationError(NOT_A_BUNDLE)
    }
    entries.push({
      name,
      method: directory.readUInt16LE(at + 10),
      crc: directory.readUInt32LE(at + 16),
      compressed: directory.readUInt32LE(at + 20),
      size: directory.readUInt32LE(at + 24),
      offset: directory.readUInt32LE(at + 42),
    })
    at += CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength
  }
  return entries
}

/** Checks the running CRC and the declared size of what flows through it. */
function verifying(entry: IndexedEntry): Transform {
  let crc = 0
  let bytes = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > entry.size) {
        callback(new ValidationError(DAMAGED))
        return
      }
      crc = crc32(chunk, crc)
      callback(null, chunk)
    },
    flush(callback) {
      callback(
        bytes === entry.size && crc === entry.crc
          ? null
          : new ValidationError(DAMAGED),
      )
    },
  })
}

/** An opened zip file: its entries, and a way to read or unpack each one. */
export class ZipArchive {
  readonly entries: ReadonlyArray<ZipEntryInfo>
  readonly #handle: FileHandle
  readonly #file: string
  readonly #index: ReadonlyMap<string, IndexedEntry>

  constructor(
    file: string,
    handle: FileHandle,
    index: ReadonlyMap<string, IndexedEntry>,
  ) {
    this.#file = file
    this.#handle = handle
    this.#index = index
    this.entries = [...index.values()].map(({ name, size }) => ({
      name,
      bytes: size,
    }))
  }

  #require(name: string): IndexedEntry {
    const entry = this.#index.get(name)
    if (entry === undefined) {
      throw new ValidationError(`The document is missing "${name}".`)
    }
    return entry
  }

  async #dataStart(entry: IndexedEntry): Promise<number> {
    const header = await readAt(this.#handle, entry.offset, LOCAL_HEADER_BYTES)
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new ValidationError(DAMAGED)
    }
    return (
      entry.offset +
      LOCAL_HEADER_BYTES +
      header.readUInt16LE(26) +
      header.readUInt16LE(28)
    )
  }

  /** The content of a small entry; refuses one bigger than `maxBytes`. */
  async read(name: string, maxBytes: number): Promise<Buffer> {
    const entry = this.#require(name)
    if (entry.size > maxBytes) {
      throw new ValidationError(`"${name}" in the document is too large.`)
    }
    const start = await this.#dataStart(entry)
    const raw = await readAt(this.#handle, start, entry.compressed)
    const data =
      entry.method === DEFLATED
        ? inflateRawSync(raw, { maxOutputLength: entry.size })
        : raw
    if (data.length !== entry.size || crc32(data) !== entry.crc) {
      throw new ValidationError(DAMAGED)
    }
    return data
  }

  /** Unpacks an entry into `destination`, checking its size and CRC as it goes. */
  async extract(
    name: string,
    destination: string,
    maxBytes = Number.POSITIVE_INFINITY,
  ): Promise<void> {
    const entry = this.#require(name)
    if (entry.size > maxBytes) {
      throw new ValidationError(`"${name}" in the document is too large.`)
    }
    const start = await this.#dataStart(entry)
    const source = createReadStream(this.#file, {
      start,
      end: start + entry.compressed - 1,
    })
    const out = createWriteStream(destination)
    try {
      if (entry.method === DEFLATED) {
        await pipeline(source, createInflateRaw(), verifying(entry), out)
      } else {
        await pipeline(source, verifying(entry), out)
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error
      throw new ValidationError(DAMAGED, { cause: error })
    }
  }

  async close(): Promise<void> {
    await this.#handle.close()
  }
}

/** Opens a zip file for reading; refuses anything that is not a plain, unencrypted zip. */
export async function openZip(file: string): Promise<ZipArchive> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    if (size < END_RECORD_BYTES) throw new ValidationError(NOT_A_BUNDLE)
    const tailLength = Math.min(size, END_RECORD_BYTES + MAX_COMMENT_BYTES)
    const tail = await readAt(handle, size - tailLength, tailLength)
    const end = endRecordOffset(tail)
    const count = tail.readUInt16LE(end + 10)
    const length = tail.readUInt32LE(end + 12)
    const offset = tail.readUInt32LE(end + 16)
    if (offset + length > size) throw new ValidationError(NOT_A_BUNDLE)
    const directory = await readAt(handle, offset, length)
    const index = new Map<string, IndexedEntry>()
    for (const entry of parseCentral(directory, count)) {
      if (
        entry.offset + entry.compressed > size ||
        (entry.method !== STORED && entry.method !== DEFLATED)
      ) {
        throw new ValidationError(NOT_A_BUNDLE)
      }
      if (index.has(entry.name)) throw new ValidationError(DAMAGED)
      index.set(entry.name, entry)
    }
    return new ZipArchive(file, handle, index)
  } catch (error) {
    await handle.close()
    throw error
  }
}
