# Built-app browser fixture

`24-comail-browser.spec.ts` drives a built Next app, its real API routes, and a real disposable Stalwart server. The loopback fixture supplies two synthetic Inbox relay identities and canonical groupware responses. It checks the application's HMAC assertions, audience, expiry, mailbox and one-use sign-in codes. It does not implement OAuth, an AT PDS, canonical storage, or actual consent; a fixture state change represents consent completion. These tests are UI and bridge-protocol evidence only.

Run only on an isolated machine with the integration Stalwart accounts and no production credentials. Start a production build of the candidate on `127.0.0.1:3000` with these values, using the disposable Stalwart URL and a separate synthetic session secret:

```sh
ATPROTO_LOGIN_URL=http://127.0.0.1:18990/login
BULWARK_INBOX_SSO_SECRET=comail-browser-fixture-secret-2026-only
INBOX_SSO_REDEEM_URL=http://127.0.0.1:18990/redeem
INBOX_MAILBOX_SESSION_URL=http://127.0.0.1:18990/webmail/session
INBOX_CALENDAR_BRIDGE_URL=http://127.0.0.1:18990/webmail/calendar/api/v1
INBOX_CONTACTS_BRIDGE_URL=http://127.0.0.1:18990/webmail/contacts/api/v1
INBOX_FILES_BRIDGE_URL=http://127.0.0.1:18990/webmail/files/api/v1
INBOX_MAIL_BRIDGE_URL=http://127.0.0.1:18990/webmail/mail/api/v1
INBOX_GROUPWARE_AUTHORIZATION_ORIGIN=https://fixture.invalid
CALENDAR_ENABLED=true
CONTACTS_ENABLED=true
FILES_ENABLED=true
IDENTITY_MANAGEMENT_ENABLED=false
```

Set `JMAP_SERVER_URL` to the disposable Stalwart JMAP server. Configure the integration account environment to match that server. The fixture binds loopback itself while the single-worker test runs; do not start another service on port 18990. If the port or webmail address changes, set `COMAIL_UI_FIXTURE_PORT` and `IT_WEBMAIL_URL` in the test process and use matching addresses in the Next environment. The test aborts only public AppView/typeahead calls; it does not intercept Next auth or authorization routes.

```sh
IT_NO_DOCKER=1 IT_WEBMAIL_URL=http://127.0.0.1:3000 \
  npx playwright test -c playwright.integration.config.ts integration/tests/24-comail-browser.spec.ts
```

The existing integration global setup checks Stalwart and the application health endpoint. Teardown closes the loopback fixture. Tests create no persistent fixtures and send no mail. Run the existing `01-login`, `11-multi-account-calendar`, `12-multi-account-contacts`, `13-files-account-switch`, and `16-phone-layout` specs separately for Stalwart coverage; their data and behavior are distinct from this synthetic bridge.
