# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Export

**Full build → EXE (the standard workflow):**
```powershell
# 1. Build frontend (only needed when client/src changes)
cd "c:\Users\RNO\Desktop\NewTask - V10 url - Copy (3) - cluade\client"
npm run build

# 2. Bundle server + inject into bahar.exe
cd "c:\Users\RNO\Desktop\NewTask - V10 url - Copy (3) - cluade\server"
Stop-Process -Name "bahar" -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; node --max-old-space-size=4096 build.mjs
```
Output: `server/release/bahar.exe` + `server/release/.env`

**Server-only changes** (no client edits): skip step 1, run only step 2.

**Dev server** (no EXE, hot reload):
```powershell
cd server && npm run dev   # nodemon on src/server.js, port 5001
cd client && npm run dev   # Vite dev server
```

**Frontend lint:**
```powershell
cd client && npm run lint
```

**No test suite exists** in this project.

## Architecture

### Deployment model
The app ships as a single Windows EXE (`bahar.exe`) built with Node.js SEA (Single Executable Application). The build pipeline (`server/build.mjs`):
1. Reads `client/dist/` and base64-encodes every file into `server/src/inlinedDist.generated.js`
2. Bundles all server JS with esbuild → `bundle.js`
3. Injects the blob into a copy of `node.exe` → `release/bahar.exe`

At runtime the EXE serves the embedded frontend files directly from memory and exposes a REST API on port 5001. There is no separate web server — the EXE binds to `0.0.0.0:5001` and all machines on the LAN access it via `http://<host-ip>:5001`.

### Database
- **SQL Server** (`mssql` package), database `AlBaharTaskManagement`
- Connection config: `server/src/config/db.config.js` — uses production hardcoded values when running as EXE, `.env` values in dev
- **Schema is adaptive**: the server probes for column/table/view existence at runtime (e.g. `COL_LENGTH(...)`, `OBJECT_ID(...)`) and works with both the legacy schema (UserID-based) and the new schema (VacancyID-based). Never assume a column exists — always check `HasXxx` flags from schema probes.
- **Auto-migrations** run on every startup (`server/src/utils/dbMigrations.js`): they `ALTER TABLE` to add missing columns/tables/indexes. Adding new migrations here is the standard way to evolve the schema.

### Identity & actor resolution
Two parallel identity systems coexist:
- **Legacy**: `UserID` (string, e.g. `"d1-8013"`) stored in `Users.UserID`
- **New**: `VacancyID` (integer) stored in `JobVacancies`, linked to users via `Assignments` table and `vw_UserCurrentProfile` view

Key utilities:
- `server/src/utils/vacancyResolver.js` — `detectSchema()`, `resolveVacancyId()`, `resolveActorId()`: converts between UserID ↔ VacancyID defensively
- `server/src/utils/delegationUtils.js` — `detectIdentitySchema()`, `resolveAccessActorId()`, `getTasksQueryWithDelegation()`: handles delegation-aware task queries
- `client/src/utils/actorIdentity.ts` — `resolveCurrentActorId()`, `resolveUserActorId()`: reads `CurrentVacancyID > ActiveVacancyID > VacancyID > UserID` in that priority order
- `client/src/utils/activeAccount.ts` — manages `albahar-active-account` in localStorage for delegation mode (actorId = delegator's ID when delegating)

**Rule**: whenever resolving an actor for DB storage or comparison, always use `resolveActorId()` (server) or `resolveCurrentActorId()` (client) — never compare raw IDs directly.

### Department scoping
`resolveIndependentDeptGroup(pool, deptId)` in `vacancyResolver.js` returns all departments belonging to the same independent group. Use this (not just `= @DirectDeptID`) for any query scoped to a department — e.g. task search, user lists.

### Task access control
`checkTaskAccess(pool, taskId, userId, isAdmin, action)` in `taskController.js` is the central access gate. It handles:
- Direct task creator/assignee
- Department membership (including independent group)
- Delegation permissions (`TaskDelegations`, `CheckTaskDelegationPermission` SQL function)
- Personal tasks (`PersonalOwnerUserID`)

### Delegation mode (client)
When a user acts as delegate: `albahar-active-account.actorId` = delegator's VacancyID/UserID. The client passes `delegateUserId` param in API calls. The server uses this to suppress the delegator's personal tasks from appearing to the delegate.

### Frontend structure
- `client/src/pages/TaskList.tsx` — main task list with tabs: active / actioned / completed / personal. Has sub-tabs "مهام الوظيفة" / "المهام الخاصة" inside the active tab.
- `client/src/components/UnifiedTimeline.tsx` — subtask + comment timeline inside task detail. Handles bulk assign, inline editing, calendar flags.
- `client/src/components/SidebarCalendar.tsx` — mini calendar in the sidebar.
- `client/src/pages/CalendarPage.tsx` — full calendar view with multiple tabs.
- `client/src/pages/TaskDetail.tsx` — task detail page; fetches subtasks from `tasks/:id/subtasks` (returns ALL subtasks for the task, no user filter).

### API conventions
- All API routes are under `/api/`
- User identity is passed as `user-id` header or `UserID`/`userId` in request body/query
- Admin status: `isAdmin` boolean in body/query (`resolveIsAdmin(req)` on server)
- The server reads acting user via `resolveActingUserId(req)` which checks `body.UserID || body.userId || body.assignedByUserId || query.userId || headers['user-id']`
