# Integration tests against Stalwart

The harness runs this checkout against a disposable Stalwart server in Docker
and drives authentication, mail synchronization and account flows with Playwright.
It uses synthetic `alice`, `bob` and `carol` accounts on `example.org`.

See the [pinned upstream harness documentation](https://github.com/bulwarkmail/webmail/blob/af32c846a2a4b684e21db1f05ce815ea08e26780/integration/README.md)
for the stack, account setup, environment variables, broader suite and diagnostics.
The harness scripts and Compose files are included in this source snapshot.

## Run the smoke suite

Install Node 24 dependencies with `npm ci` and start Docker, then run from the
repository root:

```sh
IT_GREP=@smoke IT_DYNAMIC_PORTS=1 IT_TEARDOWN=1 integration/run-tests.sh
```

Run `integration/run-tests.sh` without `IT_GREP` for the broader suite.
Diagnostics go to `integration/test-results` and `integration/playwright-report`.
`IT_TEARDOWN=1` removes this test stack and its disposable mail data on exit.
Keep personal accounts, production servers and real mail out of this harness.

The webmail container uses Next.js development mode so it can reach the local
HTTP JMAP server. A passing smoke run checks the synthetic account flows; the
standalone production build has its own build and bundle checks.
