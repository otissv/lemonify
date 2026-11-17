# Authentication

People sign up and sign in on the website with an email address and a password. Better Auth owns accounts, passwords and sessions; its tables come from the migrations, so there is one migration history. A session is an HTTP-only cookie named `lemonify.session_token`, and every server function and API route identifies the caller through the `AuthGateway` interface, so services never depend on Better Auth directly.

## Email through Resend

Setting `LEMONIFY_RESEND_API_KEY` and `LEMONIFY_EMAIL_FROM` together turns email on. The sender must be an address on a domain verified in Resend, for example `Lemonify <hello@example.com>`; setting only one of the two stops the app at startup with a message naming both. With neither set, the website works as before: sign-up signs the person in at once, and the sign-in page shows no password reset. That is the right setting for local development, the end-to-end tests and a single-user machine.

With email on, two things change. A new account must follow the link in the confirmation email before it can sign in; until then sign-in answers that the email is not confirmed and the page offers to send the link again. And the sign-in page offers "Forgot your password?", which emails a link to a page where the person chooses a new one. Both links work for one hour and once. Following the confirmation link signs the person in. Changing a password signs the account out everywhere, so a stolen session does not survive a reset.

Mail is sent with Resend's HTTP API using the platform `fetch` with a ten second limit, not a client library. Failures are logged with the reason and the kind of email, never the address or the key.

## What the design protects against

Sending is done in the background and its failure is only logged. Waiting for Resend would make a request for an address that has an account slower than one for an address that has none, which would tell a stranger who is registered; for the same reason, asking for a reset answers identically either way and nothing is sent for an unknown address.

Each email costs money and can fill a stranger's inbox, so the routes that send one are limited in the `/api/auth` route handler before Better Auth sees the request: five a quarter of an hour per address, and three an hour about any one recipient however many addresses ask. Every sign-in route is also limited to thirty a minute per address to slow password guessing. Better Auth's own limiter is off outside production and cannot see the client address behind a proxy, so it is not relied on. Sign-in itself never sends mail, so a mistyped password cannot be used to flood someone.

Callback and redirect addresses are fixed paths on the site, and Better Auth rejects any other origin that is not in `LEMONIFY_TRUSTED_ORIGINS`, so a link cannot be made to send the person elsewhere. The reset link carries its token in the address, as the standard flow does; the reset page loads nothing from other sites, so the token is not passed on.

## The command line

The command line creates accounts only for the single local user on a machine that has none. It vouches for the address, so that account is confirmed from the start and no email is sent, even when Resend is configured.
