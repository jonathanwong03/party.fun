# party.fun

`party.fun` is a React + Vite frontend with a lightweight Express API skeleton. The UI still uses mocked frontend data and mocked frontend-only auth for now. Supabase, real sessions, and database storage are planned for a later stage.

## Current accounts (Only 2) 
# This will be subjected to change once we have proper database tables & user authentication
1. Demo user account email: jamie@u.nus.edu , password: user123
2. Demo admin account email: organiser@smu.edu.sg, password: organiser123
- For now, refer to backend/data/mockUsers.js for information

## Project Directory

Run commands from:

```powershell
C:\smu heap\party.fun
```

## Structure

```text
party.fun/
  frontend/   React + Vite app
  backend/    Express API skeleton
```

The root package provides build and helper commands. The recommended dev workflow runs the frontend and backend in separate terminals.

## Install

Install each package separately:

```powershell
npm install
npm --prefix frontend install
npm --prefix backend install
```

## Run

For the cleanest Windows shutdown behavior, run the frontend and backend in separate terminals with direct Node commands.

How to run both terminals:

Terminal 1:

```powershell
cd "C:\smu heap\party.fun\frontend"
npm run dev
```

Terminal 2:

```powershell
cd "C:\smu heap\party.fun\backend"
npm run dev
```

Try the below as a backup (unlikely occurence):

Terminal 1:

```powershell
cd "C:\smu heap\party.fun\frontend"
node .\node_modules\vite\bin\vite.js --host localhost --port 5173
```

Terminal 2:

```powershell
cd "C:\smu heap\party.fun\backend"
node .\server.js
```

Expected URLs:

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:8000/api/health`
- Proxied health check: `http://localhost:5173/api/health`

The root helper command prints these instructions:

```powershell
npm run dev
```

Package scripts are still available if you prefer npm wrappers:

```powershell
npm run dev:frontend
npm run dev:backend
```

For less npm output inside each package:

```powershell
npm run dev --silent
```

## Build

```powershell
npm --prefix frontend run build
```

The frontend build output is written to `frontend/dist/`.

## Frontend Auth

Authentication is currently mocked in the frontend only:

- Any non-admin email logs in as a user.
- Any email containing `admin` logs in as an admin.
- Passwords are not validated yet.
- Refreshing the app clears the role and returns the user to the Welcome back login page.

No backend auth, Supabase, Clerk, cookies, sessions, or persistent login state is implemented yet.

## API Skeleton

The backend currently returns placeholder JSON with `status: "not_implemented"`.

Examples:

- `GET /api/health`
- `GET /api/auth/login`
- `POST /api/auth/register`
- `GET /api/events`
- `GET /api/events/e1`
- `GET /api/checkout/e1`
- `GET /api/profile`
- `GET /api/confirmation/e1`
- `GET /api/dashboard`
- `GET /api/dashboard/events/new`
- `GET /api/dashboard/events/e1/edit`

## Stopping The Dev Servers On Windows

The recommended direct commands avoid the long-running npm `.cmd` wrapper that causes the `Terminate batch job (Y/N)?` prompt in many Windows terminals.

Use `Ctrl+C` in each terminal:

- Frontend terminal returns to `PS C:\smu heap\party.fun\frontend>`.
- Backend terminal returns to `PS C:\smu heap\party.fun\backend>`.

If you run the package npm scripts instead of the direct Node commands, Windows may still show npm's normal script header or batch prompt behavior.
