# 01 — Project Technology Stack

> STOCKWISE ERP — read-only structure audit, 2026-11-16 (git `main` @ `b858f10` + uncommitted working-tree changes).
> Legend: **[V]** Verified from source / lock files · **[I]** Inferred from evidence · **[U]** Unknown (not verifiable read-only).
> No database connection was made. No command that changes state was run.

## 1. Repository layout [V]

| Folder | Content |
|---|---|
| `backend/` | Laravel REST API (also serves the built SPA from `backend/public/app.html`) |
| `frontend/` | React SPA (Vite) |
| `sync-service/` | Python Sync Agent: copies the Accurate 5 Firebird `.GDB` → staging → pushes tables to `/api/agent/sync` |
| `docs/` | Design / phase reports (existing, not modified). This audit lives in `docs/audit/` |
| root `*.bat` | `start-dev.bat`, `start-server.bat`, `deploy.bat` (Windows operations) |

## 2. Backend

| Aspect | Finding | Evidence |
|---|---|---|
| Language | PHP 8.4 (local runtime 8.4.23; `composer.json` requires `^8.3`) [V] | `php -r PHP_VERSION`, `composer.json` |
| Framework | **Laravel 13** (`laravel/framework` v13.30.1 in `composer.lock`) [V] | `composer.lock` |
| API style | JSON REST under `/api/*`, 498 route definitions in one file `routes/api.php` (921 lines); controllers in `app/Http/Controllers/Api` (69 API controllers) [V] | `routes/api.php` |
| ORM | Eloquent (96 models in `app/Models`) + heavy use of the Query Builder (`DB::table(...)`) for logs, approvals and reports [V] | grep |
| Authentication | Laravel **Sanctum** bearer tokens; login `POST /api/login` (throttle 20/min); token TTL 12 h (`STOCKWISE_LOGIN_TOKEN_TTL_HOURS`) [V/README] | `AuthController`, README |
| Authorization | Custom RBAC: `roles`, `permissions`, pivots; catalogue + default matrix in `app/Support/Rbac/Rbac.php` (9 roles, ~150 permission slugs); route middleware `permission:a|b` (`CheckPermission`); in-controller `hasPermission()` / `hasRole()` checks. **No Laravel Policies / Gates** (`app/Policies` does not exist) [V] | `bootstrap/app.php`, `CheckPermission.php` |
| Agent auth | Separate Sanctum ability `agent:sync` + `EnsureAgentToken` middleware for the Sync Agent [V] | `routes/api.php` |
| Business logic | Service classes in `app/Services` (72 files: Inventory, Mrp, Disassembly, Tracking, Accurate, Export, approvals) and `app/Support`. Some flows still live in controllers (e.g. RI creation in `RiController`) [V] | file tree |
| Background work | **No queued jobs, events or listeners** (`app/Jobs`, `app/Events`, `app/Listeners` absent). `QUEUE_CONNECTION=sync`. Long work is spawned as a separate `php artisan` process (`App\Support\BackgroundArtisan`, e.g. `accurate:finish-batch`). Scheduler: only `important-requests:remind` in `routes/console.php`; the Sync Agent is run by Windows Task Scheduler [V] | file tree, `.env.example` |
| Notifications | Laravel database notifications (`notifications` table) via `NotificationDispatcher` + polling endpoint `/api/live` (no WebSocket) [V] | `LiveController` |
| Files | Local disk (`Storage::disk('local')`) for photos, signatures, attachments; served through authenticated controller endpoints [V] | `TrackingPhotoController`, `DocumentController` |
| Exports | `phpoffice/phpspreadsheet` (Excel), CSV, PDF (HTML render + headless Chrome path in `config/stockwise.php`) [V/I] | `composer.json`, `config/stockwise.php` |
| Tests | PHPUnit 12 — 108 test files (`tests/Feature`, `tests/Unit`); run on SQLite in-memory (`phpunit.xml`) [V]. Tests were **not run** in this audit. | `tests/` |
| Runtime (production) | `php artisan serve --port=8001` as a Windows service (NSSM) on server 192.168.2.41, running straight from `backend/` — PHP edits are live immediately [V README / project memory] | README |

## 3. Frontend

| Aspect | Finding |
|---|---|
| Language | TypeScript ~6.0 [V] |
| Framework | **React 19.2** + Vite 8 [V `package.json`] |
| Routing | `react-router-dom` 7 (`createBrowserRouter` in `src/router.tsx`) [V] |
| Server state | **TanStack React Query 5** (`lib/queryClient.ts`); no Redux/Zustand. Auth state in `auth/AuthContext` [V] |
| Forms / validation | `react-hook-form` + `zod` [V] |
| UI | Tailwind CSS 3 + shadcn-style primitives in `components/ui` (button, card, modal, select …), `lucide-react` icons, `recharts`, `sonner` toasts, `@dnd-kit` [V] |
| API integration | `axios` instance in `lib/api.ts`; `baseURL = VITE_API_URL ?? ''` (same-origin in production); bearer token stored in **`localStorage`** and added per request; 401 → forced logout [V] |
| Permission-based navigation | `lib/navigation.ts` (sidebar) and `lib/launcher.ts` (App Launcher) filter items by permission; routes wrapped in `RequirePermission` / `RequireRole` guards (`auth/guards.tsx`) [V]. Frontend guards are UX only; backend re-checks. |
| Live refresh | Polling `/api/live` hash per area (`lib/live.ts`) [V] |
| Tests | Vitest (25 test files) + Playwright e2e (4 specs) [V] — not run |
| Build / deploy | `npm run build` → `dist/` copied into `backend/public/assets` + `app.html` (`deploy.bat`). Many hashed bundles accumulate in `backend/public/assets` (untracked files in git status) [V] |

## 4. Database

| Aspect | Finding |
|---|---|
| Engine | **MySQL 8** (`DB_CONNECTION=mysql`; README names service `MySQL84` → MySQL 8.4) [V config / I version]. Exact server version **[U]** (DB not queried). |
| Tests | SQLite in-memory; migrations are written to stay portable [V] |
| Tables defined by migrations | **126** existing after replaying 131 migrations (5 more were created then dropped) [V static replay] |
| Runtime tables | **26** `accurate_*` mirror tables created by `StagingTableWriter` from the whitelist in `config/accurate.php` [V code] — columns **[U]** |
| Migration history | 131 files dated `0001_01_01` … `2026_11_16_110000`. Two newest (`create_vendor_prices`, `item_unit_conversions_base_unit`) are **untracked in git**; whether they ran on production **[U]**. |
| Integration source | Accurate 5 (Firebird 2.5) — read-only file copy → staging Firebird (`127.0.0.1:3050`) → API → MySQL [V README / code] |

## 5. Configuration flags that change behaviour (values only, no secrets)

| Flag | Default in code | Observed in this working copy's `.env` | Effect |
|---|---|---|---|
| `STOCKWISE_ACCURATE_ONLY` | `true` (`config/stockwise.php:93`) | not set → **true** [V] | Nightly scheduled sync **purges data created in STOCKWISE** (requests, manual NPBG/PPB/RI, STOCKWISE POs, drafts, returns, their stock movements) — `StockwisePurge` |
| `STOCKWISE_PURGE_WINDOW` | `18:00-06:00` | not set | Window in which a scheduled sync purges |
| `STOCKWISE_LEDGER_SINCE` | `2026-10-23 03:00:00` | — | Cut-off used by stock netting (`StockwiseNet`) |
| `APP_ENV` / `APP_DEBUG` | — | `local` / **`true`** [V] | If this `.env` is the production one (project memory says production runs from this folder), debug pages/stack traces can be exposed [I] |

## 6. Stack summary

Laravel 13 (PHP 8.4) monolithic REST API + React 19/TypeScript SPA, MySQL 8, Sanctum tokens, custom permission RBAC, synchronous processing (no queue), Accurate 5 as the upstream system of record through a Python agent, single Windows server.
