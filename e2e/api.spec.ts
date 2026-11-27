import { readFileSync } from 'node:fs'

import { expect, request as playwrightRequest, test } from '@playwright/test'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import sharp from 'sharp'
import { z } from 'zod'

import { E2E_ORIGIN } from '../playwright.config.ts'
import { RunsResult, WorkflowResult, cliResult } from './cli.ts'
import { E2E_STORE } from './database.ts'
import { SCRATCH_ACCOUNTS } from './global-setup.ts'
import type { Manifest } from './seed.ts'
import { uniqueName } from './workflow-page.ts'

/**
 * Every route under /api, called over HTTP as a browser or a script would:
 * what it gives its owner, and that it refuses someone who is not signed in,
 * another User, and requests it cannot take, always answering a failure as
 * { data: [], error } with no detail of the server's insides.
 */
const OWNER = SCRATCH_ACCOUNTS.api
const OTHER = SCRATCH_ACCOUNTS.apiOther
const DATA = E2E_STORE
const USER = ['--user', OWNER.user.name]
const RUN_TIMEOUT = 60_000
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

const FailureSchema = z.object({
  data: z.array(z.never()),
  error: z.string().min(1),
})
const SourceSchema = z.object({
  data: z.array(
    z.object({ id: z.string(), fileName: z.string(), mediaType: z.string() }),
  ),
  error: z.literal(''),
})
const ImportSchema = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string() })),
  error: z.literal(''),
})

test.describe.configure({ mode: 'serial', timeout: 120_000 })

let owner: APIRequestContext
let other: APIRequestContext
let visitor: APIRequestContext
let png: Buffer
let sourceId = ''
let documentId = ''
let documentRender = ''
let workflowId = ''
let workflowRender = ''
let runId = ''
let resultId = ''
let failedRunId = ''

async function asUser(
  storageState: string | undefined,
): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: E2E_ORIGIN,
    storageState: storageState ?? { cookies: [], origins: [] },
  })
}

/** A failure answers in the project's shape, with a message for people and nothing from the server's insides. */
async function expectFailure(
  response: APIResponse,
  status: number,
): Promise<string> {
  expect(response.status(), response.url()).toBe(status)
  const text = await response.text()
  expect(text).not.toMatch(/at .+\.(ts|js):\d+|node_modules|SQLITE|\/home\//)
  return FailureSchema.parse(JSON.parse(text)).error
}

/** The routes that give one of the owner's files, each with what a refusal must not reveal. */
function ownedFiles(): ReadonlyArray<string> {
  return [
    `/api/sources/${sourceId}`,
    documentRender,
    `/api/documents/${documentId}/bundle`,
    `/api/results/${resultId}`,
    `/api/workflow-runs/${runId}/archive`,
    workflowRender,
  ]
}

async function upload(
  context: APIRequestContext,
  body: Buffer,
  headers: Record<string, string>,
): Promise<APIResponse> {
  return context.post('/api/sources', { data: body, headers })
}

async function runFinished(
  id: string,
): Promise<z.infer<typeof RunsResult>['runs'][number]> {
  let found: z.infer<typeof RunsResult>['runs'][number] | undefined
  await expect
    .poll(
      async () => {
        const { runs } = await cliResult(
          DATA,
          ['workflow', 'runs', '--workflow', workflowId, ...USER],
          RunsResult,
        )
        found = runs.find((run) => run.id === id)
        return found?.state
      },
      { timeout: RUN_TIMEOUT },
    )
    .not.toBe('running')
  if (found === undefined) throw new Error(`Run ${id} is gone.`)
  return found
}

test.beforeAll(async ({ browser }) => {
  owner = await asUser(OWNER.authFile)
  other = await asUser(OTHER.authFile)
  visitor = await asUser(undefined)
  png = await sharp({
    create: { width: 48, height: 32, channels: 3, background: '#7744aa' },
  })
    .png()
    .toBuffer()

  const manifest: Manifest = JSON.parse(
    readFileSync(OWNER.manifestFile, 'utf8'),
  )
  const seeded = manifest['blur-default']
  if (seeded === undefined) throw new Error('The owner has no document.')
  documentId = seeded

  // The address of a render is only known to the page that asked for it.
  const page = await browser.newPage({ storageState: OWNER.authFile })
  await page.goto(`/documents/${documentId}`)
  const picture = page.locator(
    '[data-slot="canvas"] img[src*="/renders/preview/"]',
  )
  await picture.waitFor({ timeout: RUN_TIMEOUT })
  documentRender = (await picture.getAttribute('src')) ?? ''
  await page.close()
})

test.afterAll(async () => {
  await Promise.all([owner.dispose(), other.dispose(), visitor.dispose()])
})

test('POST /api/sources stores an image for its owner, once however often it is sent', async () => {
  const headers = {
    'Content-Type': 'image/png',
    'X-File-Name': encodeURIComponent('api photo.png'),
  }
  const created = await upload(owner, png, headers)
  expect(created.status()).toBe(201)
  const [source] = SourceSchema.parse(await created.json()).data
  expect(source).toMatchObject({
    fileName: 'api photo.png',
    mediaType: 'image/png',
  })
  sourceId = source?.id ?? ''

  const again = SourceSchema.parse(
    await (await upload(owner, png, headers)).json(),
  )
  expect(again.data[0]?.id).toBe(sourceId)
})

test('POST /api/sources refuses what is not an image it takes, or not named, or from nobody', async () => {
  const named = { 'X-File-Name': 'a.png' }
  expect(
    await expectFailure(
      await upload(owner, png, { ...named, 'Content-Type': 'text/plain' }),
      422,
    ),
  ).toContain('Use one of')
  expect(
    await expectFailure(
      await upload(owner, Buffer.from('not really a picture at all'), {
        ...named,
        'Content-Type': 'image/png',
      }),
      422,
    ),
  ).toBe('That file is not the kind of image its type says it is.')
  expect(
    await expectFailure(
      await upload(owner, png, { 'Content-Type': 'image/png' }),
      422,
    ),
  ).toContain('X-File-Name')
  await expectFailure(
    await upload(visitor, png, { ...named, 'Content-Type': 'image/png' }),
    401,
  )
})

test('GET /api/sources/<id> gives the image as it was uploaded, safely', async () => {
  const response = await owner.get(`/api/sources/${sourceId}`)
  expect(response.status()).toBe(200)
  expect(Buffer.from(await response.body()).equals(png)).toBe(true)
  expect(response.headers()).toMatchObject({
    'content-type': 'image/png',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
  })
  expect(response.headers()['cache-control']).toMatch(/^private,.*immutable/)
})

test('GET /api/documents/<id>/renders/<kind>/<key> gives the picture the editor shows', async () => {
  const response = await owner.get(documentRender)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toBe('image/webp')
  await expectFailure(
    await owner.get(
      documentRender.replace('/renders/preview/', '/renders/poster/'),
    ),
    404,
  )
})

test('GET /api/documents/<id>/bundle and POST /api/documents/import take a document out and bring it back', async () => {
  const bundle = await owner.get(`/api/documents/${documentId}/bundle`)
  expect(bundle.status()).toBe(200)
  expect(bundle.headers()['content-disposition']).toMatch(
    /^attachment; filename=/,
  )
  const file = Buffer.from(await bundle.body())

  const imported = await owner.post('/api/documents/import', {
    data: file,
    headers: { 'Content-Type': bundle.headers()['content-type'] ?? '' },
  })
  expect(imported.status()).toBe(201)
  const [document] = ImportSchema.parse(await imported.json()).data
  expect(document?.id).not.toBe(documentId)

  expect(
    await expectFailure(
      await owner.post('/api/documents/import', {
        data: file,
        headers: { 'Content-Type': 'application/json' },
      }),
      422,
    ),
  ).toBe('Send a document file.')
  await expectFailure(
    await owner.post('/api/documents/import', {
      data: Buffer.from('not a zip'),
      headers: { 'Content-Type': bundle.headers()['content-type'] ?? '' },
    }),
    422,
  )
  await expectFailure(
    await visitor.post('/api/documents/import', {
      data: file,
      headers: { 'Content-Type': bundle.headers()['content-type'] ?? '' },
    }),
    401,
  )
})

test('GET /api/results/<id> and /api/workflow-runs/<id>/archive give a run’s images', async ({
  browser,
}, testInfo) => {
  const name = uniqueName(testInfo, 'Api run')
  const created = await cliResult(
    DATA,
    [
      'workflow',
      'create',
      name,
      '--sources',
      sourceId,
      '--steps',
      '[{"op":"flip"}]',
      ...USER,
    ],
    WorkflowResult,
  )
  workflowId = created.workflow.id
  const queued = RunsResult.shape.runs.element.parse(
    (
      await cliResult(
        DATA,
        ['workflow', 'run', workflowId, ...USER],
        z.object({ run: z.unknown() }),
      )
    ).run,
  )
  const finished = await runFinished(queued.id)
  expect(finished.state).toBe('done')
  runId = finished.id
  resultId = finished.items[0]?.resultIds[0] ?? ''

  const result = await owner.get(`/api/results/${resultId}`)
  expect(result.status()).toBe(200)
  expect(result.headers()).toMatchObject({
    'content-type': 'image/png',
    'content-disposition': expect.stringContaining('api%20photo.png'),
    'cache-control': 'private, no-cache',
  })
  const flipped = await sharp(Buffer.from(await result.body())).metadata()
  expect(flipped).toMatchObject({ width: 48, height: 32 })

  const archive = await owner.get(`/api/workflow-runs/${runId}/archive`)
  expect(archive.status()).toBe(200)
  expect(archive.headers()['content-type']).toBe('application/zip')
  expect(archive.headers()['content-disposition']).toContain(
    `${encodeURIComponent(name)}.zip`,
  )
  expect(
    Buffer.from(await archive.body())
      .subarray(0, 2)
      .toString(),
  ).toBe('PK')

  const page = await browser.newPage({ storageState: OWNER.authFile })
  await page.goto(`/workflows/${workflowId}`)
  const picture = page.locator('img[src*="/api/workflows/"]').first()
  await picture.waitFor({ timeout: RUN_TIMEOUT })
  workflowRender = (await picture.getAttribute('src')) ?? ''
  await page.close()
  const render = await owner.get(workflowRender)
  expect(render.status()).toBe(200)
  expect(render.headers()['content-type']).toBe('image/webp')

  // A run in which nothing was finished has nothing to put in a zip.
  const failing = await cliResult(
    DATA,
    [
      'workflow',
      'update',
      workflowId,
      '--steps',
      '[{"op":"extract","options":{"left":0,"top":0,"width":500,"height":500}}]',
      ...USER,
    ],
    WorkflowResult,
  )
  expect(failing.workflow.pipeline.steps).toHaveLength(2)
  const failed = RunsResult.shape.runs.element.parse(
    (
      await cliResult(
        DATA,
        ['workflow', 'run', workflowId, ...USER],
        z.object({ run: z.unknown() }),
      )
    ).run,
  )
  failedRunId = failed.id
  expect((await runFinished(failedRunId)).state).toBe('failed')
  await expectFailure(
    await owner.get(`/api/workflow-runs/${failedRunId}/archive`),
    422,
  )
})

test('every file route refuses someone who is not signed in', async () => {
  for (const route of ownedFiles()) {
    expect(await expectFailure(await visitor.get(route), 401), route).not.toBe(
      '',
    )
  }
})

test('every file route answers another User as if the file did not exist', async () => {
  for (const route of ownedFiles()) {
    const refused = await other.get(route)
    expect(refused.status(), route).toBe(404)
    const unknown = await other.get(
      route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, UNKNOWN_ID),
    )
    expect(unknown.status(), route).toBe(404)
    expect(await expectFailure(refused, 404), route).toBe(
      await expectFailure(unknown, 404),
    )
  }
})

test('the routes take only the methods they have, and say which', async () => {
  for (const [method, route, allowed] of [
    ['DELETE', `/api/sources/${sourceId}`, 'GET'],
    ['GET', '/api/sources', 'POST'],
    ['POST', `/api/results/${resultId}`, 'GET'],
    ['PUT', '/api/documents/import', 'POST'],
    ['PATCH', `/api/workflow-runs/${runId}/archive`, 'GET'],
  ] as const) {
    const response = await owner.fetch(route, { method })
    expect(response.headers()['allow'], `${method} ${route}`).toBe(allowed)
    expect(await expectFailure(response, 405)).toBe(`Use ${allowed} here.`)
  }
  expect((await owner.get(`/api/sources/${sourceId}`)).status()).toBe(200)
})

test('an address under /api that no route has is a 404 in the same shape', async () => {
  for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await owner.fetch('/api/nothing-here/at-all', { method })
    expect(await expectFailure(response, 404)).toBe(
      'There is nothing at this address.',
    )
  }
})
