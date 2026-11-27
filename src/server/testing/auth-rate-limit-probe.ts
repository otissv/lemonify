/**
 * Signs in with a wrong password many times through Better Auth, in a process
 * of its own, and prints each answer's status as JSON. Better Auth decides
 * whether it is in production when it is first loaded, so a test starts this
 * with NODE_ENV=production to see what the production server does.
 */
import { loadConfig } from '../config/config.ts'
import { BetterAuthGateway } from '../auth/better-auth-gateway.ts'
import { MemoryLogger } from '../http/logger.ts'

const ORIGIN = 'http://localhost:3000'
const ATTEMPTS = Number(process.argv[2] ?? '12')

const config = loadConfig(process.env)
const gateway = new BetterAuthGateway({
  database: config.database,
  secret: 's'.repeat(32),
  baseUrl: ORIGIN,
  trustedOrigins: [ORIGIN],
  email: null,
  logger: new MemoryLogger(),
})
const statuses: number[] = []
try {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const response = await gateway.handle(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({
          email: 'nobody@example.com',
          password: 'wrong password',
        }),
      }),
    )
    statuses.push(response.status)
  }
} finally {
  await gateway.close()
}
console.log(JSON.stringify({ statuses }))
