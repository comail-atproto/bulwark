# Contributing to Bulwark Webmail

This is the Comail fork. Use [the Comail pull request rules](#pull-requests)
and [AI_POLICY.md](AI_POLICY.md) for changes here. The upstream development,
translation, and integration-test instructions below remain useful; publish
Comail changes to `comail-atproto/bulwark`.

We're writing the webmail we wanted in 2026 and didn't find: a JMAP-native client with an interface built this decade. It's AGPL and self-hosted, run by the people who use it rather than sold to them.

The full guide is in the documentation under [Contributing](https://bulwarkmail.org/docs/development/contributing). It covers the development setup, the test suites, translations and right-to-left layouts, code style, and how pull requests are reviewed.

## What fits

Read [What fits in Bulwark](https://bulwarkmail.org/docs/development/contributing#what-fits-in-bulwark) before you start on a feature. In short:

- Bulwark is built for Stalwart. Changes for other JMAP servers are welcome if they cost Stalwart users nothing.
- Core is for what most people expect from a mail, calendar, contacts and files client. Niche workflows and integrations with other services belong in plugins.
- Not in core: IMAP or other non-JMAP backends, integrations with other services, Stalwart server administration, and changes to the look that go beyond themes.
- New behaviour gets one good default. If deployments really need different behaviour, add an admin setting, not a per-user toggle.
- Features must work in Bulwark Lite, or be hidden there, and UI changes must work at phone width.

Open an issue and agree on the approach before you write a change that is larger than about 500 lines (not counting locales and tests), adds a runtime dependency, or touches sign-in, sessions, the HTML sanitizer, the plugin sandbox, outgoing-request guards or admin routes. Deliver large features as a series of pull requests that can each be reviewed on their own. Pull requests with review feedback unanswered for 30 days are closed.

To get a development server running:

```bash
git clone https://github.com/comail-atproto/bulwark.git
cd bulwark
npm install
cp .env.dev.example .env.local   # built-in mock JMAP server, no mail server needed
npm run dev
```

Before you open a pull request, run `npm run typecheck && npm run lint && npx vitest run`. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:` and so on).

You can use AI tools for your contributions. The guide's [AI-assisted contributions](https://bulwarkmail.org/docs/development/contributing#ai-assisted-contributions) section explains what we expect.

By contributing, you agree that your contributions are licensed under the terms in [LICENSE](LICENSE): AGPL-3.0-only, with the additional permission for app store distribution. The permission is still provisional for older code, but it applies in full to contributions made since 30 September 2026.

Run a single unit test file with `npx vitest run lib/__tests__/<name>.test.ts`, or `npx vitest` to watch.

The relay SSO route also has a real-browser regression test. Install Chromium
with `npx playwright install chromium`, then run
`COMAIL_BROWSER_TESTS=1 npm test -- lib/__tests__/relay-route.test.ts`.
CI enables this test. It checks the browser-generated Origin and Referer
headers through the actual bootstrap and POST handlers; HTTP clients that
set Origin themselves cannot catch referrer-policy regressions.

The integration suite needs Docker and takes several minutes; it has its own setup notes and findings log in [integration/README.md](integration/README.md). New behavior that touches mail/folder synchronization or multi-account handling belongs there.

## Code style guidelines

### TypeScript

- Use TypeScript for all new code
- Define proper types and interfaces
- Avoid `any` types when possible
- Use meaningful variable and function names

### React components

- Use functional components with hooks
- Keep components focused and single-purpose
- Extract reusable logic into custom hooks
- Place components in appropriate directories under `/components`

### Styling

- Use Tailwind CSS utility classes
- Follow the existing design system
- Support both dark and light themes
- Use CSS variables for theme colors

## Internationalization (i18n)

This project uses **next-intl**. English (`/locales/en/common.json`) is the source of truth; we ship 23 additional locales (ar, ca, cs, da, de, es, fa, fr, he, hu, it, ja, ko, lv, nl, pl, pt, ro, ru, sk, tr, uk, zh).

Arabic, Hebrew, and Persian render right-to-left (see `i18n/direction.ts`). Use Tailwind's **logical** utilities (`ms-*`/`me-*`, `ps-*`/`pe-*`, `start-*`/`end-*`) rather than physical ones (`ml-*`, `pl-*`, `left-*`) so layouts flip correctly. For popovers positioned in JS via `getBoundingClientRect()`, check `isDocumentRTL()`: inline `position: fixed` styles don't pick up logical utilities.

### Rules

1. **Never hardcode user-facing text** - always use translations:

   ```tsx
   const t = useTranslations("namespace");
   return <div>{t("key")}</div>;
   ```

2. **Add new keys to `en/common.json` first.** Other locales can follow in the same PR or a follow-up - missing keys fall back to English.

3. **Namespace organization**:
   - `login.*` - login page
   - `sidebar.*` - sidebar navigation
   - `email_list.*` - email list
   - `email_viewer.*` - email viewer
   - `email_composer.*` - composer
   - `settings.*` - settings page
   - `notifications.*` - toasts and alerts
   - `common.*` - shared strings

4. **Locale-aware navigation**:

   ```tsx
   router.push(`/${params.locale}/settings`);
   ```

### Adding a new locale

Registering a new locale takes edits in four places:

1. `locales/<code>/common.json` - copy `locales/en/common.json` and translate
2. `i18n/routing.ts` - add the code to `SUPPORTED_LOCALES`
3. `i18n/request.ts` - add a `case` to the static-import switch
4. `components/ui/language-switcher.tsx` - add `{ value, label }` with the **native** language name, plus a flag in `components/ui/flag-icons.tsx`

For a right-to-left language, also add the code to `rtlLocales` in `i18n/direction.ts`.

Run `npm run test:translations` afterwards - it checks the locale files for structural drift against English.

## Pull request process

### Before submitting

1. **Create a feature branch**:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the code style guidelines

3. **Test your changes** thoroughly, and add unit tests for new logic

4. **Update translations** if you added user-facing text

5. **Run all checks**:
   ```bash
   npm run typecheck && npm run lint && npx vitest run
   ```

### Submitting

1. **Push your branch** to your fork

2. **Open a Pull Request** with:
   - Clear title describing the change
   - Description of what was changed and why
   - Screenshots for UI changes
   - Reference to any related issues

### Commit message convention

Follow the conventional commits format:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Examples:

```
feat: add email threading support
fix: resolve attachment download issue
docs: update README with keyboard shortcuts
```

## Project structure

```
webmail/
├── app/                       # Next.js App Router
│   ├── (main)/[locale]/      # Locale-aware app pages (mail, calendar, contacts, files, settings)
│   ├── (main)/admin/         # Admin dashboard
│   ├── (main)/setup/         # First-launch setup wizard
│   ├── (sandbox)/            # Isolated plugin sandbox routes
│   └── api/                  # Route handlers (auth, admin, jmap, caldav, …)
├── components/               # React components
│   ├── email/               # Email list, viewer, composer
│   ├── calendar/ contacts/ files/ filters/ templates/
│   ├── layout/              # Sidebar, shell, navigation
│   ├── settings/            # Settings panels
│   ├── plugins/             # Plugin host UI
│   └── ui/                  # Reusable primitives
├── contexts/                 # React contexts
├── hooks/                    # Custom React hooks
├── i18n/                     # next-intl routing, locale detection, RTL direction
├── lib/                      # Utilities and libraries
│   ├── jmap/                # JMAP client implementation
│   ├── stalwart/            # Stalwart-specific admin/API helpers
│   ├── admin/ auth/ oauth/  # Config, sessions, OAuth flows
│   ├── plugin-sandbox/      # Plugin sandbox bridge and hardening
│   └── __tests__/           # Vitest unit tests
├── locales/                  # Translation files, one directory per locale
├── stores/                   # Zustand state stores
├── public/                   # Static assets and branding
├── e2e/                      # Playwright smoke tests (against `npm run dev`)
└── integration/              # Dockerized Stalwart + Playwright suite
```

## Security

- **Never commit secrets** - API keys, passwords, tokens, `.env*` files
- **Sanitize user input** and email content
- **Block external content** by default - privacy is the point
- **Report vulnerabilities privately** through [SECURITY.md](SECURITY.md)

## Questions?

Open an issue, search existing ones, or ask in Discord. Thanks for helping build the webmail we all wished existed.

## Pull requests

Start from current `main` and use a feature branch. Keep changes focused and fill
out the PR template with the reason, resulting behavior, tests and any remaining
gaps. Link the relevant issue, or explain `No-Issue: <reason>` for a small change.
Required checks and an approving review must pass before merge. Commits need a
verified signature.

The required PR sections are What & why, Test evidence, and Deployment impact.
Other sections, including Change shape, Before / after, and Rollback, are
optional. Omit unused headings. Include required visual evidence and relevant
dependency or rollback details in the required sections or a useful extra
section.

A rollback plan is required for infrastructure or backend releases, or changes
to persistent state, schemas, credentials, or API compatibility. Include
recovery checks and effects a code revert cannot undo. For a simple frontend
release, name the normal previous-version redeploy path.

Use GitHub stacks for dependent PRs in this repository. Describe dependencies on
other repositories and any compatibility, deployment or rollback requirements.

Changes must be safe to deploy in any order. Ship new behavior beside the old,
switch over once both sides are released (usually with a flag), and remove the
old path in a later release (expand/contract). Each service must keep working
with the current and previous release of everything it talks to, including
host configuration. Reviewers treat a required deploy order as a finding:
restructure the change, or explain why the order cannot be avoided.

For visual changes, attach before/after screenshots or recordings directly to
the PR using synthetic data. Keep the PR draft if required attachments are
unavailable. Never commit temporary review media; preserve existing review links.
Product assets and durable documentation images belong in the repository.

## Code and comments

Follow existing patterns and use consistent names and plain language. For behavior
changes, write a failing test first, make it pass and run the affected checks.
Update generated or vendored code through its source or dependency pin.

Keep comments brief: explain contracts, constraints and reasons the code does not
make clear. Keep local tool references, assistant instructions, work notes and
tracker IDs out of code and comments. Describe current limitations where they
are implemented.

Review the final diff and remove unused code, debugging leftovers and unnecessary
wrappers. Check usage before removing compatibility paths or rollout flags.
Preserve licenses, directives, diagnostics and security boundaries.

## Issues, security and AI

Search existing issues before opening one. Use the issue template to describe
the problem, reproduction steps and expected result. Report vulnerabilities
privately through [SECURITY.md](SECURITY.md).

Respect the repository's license and contributor authorship.
[AI-assisted contributions are allowed](AI_POLICY.md) without disclosure or model
attribution. Prefer omitting "AI-assisted" stamps and boilerplate model credits.
Contributors remain responsible for correctness, testing, authorship and the right
to submit their work.
