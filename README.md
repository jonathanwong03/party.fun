# party.fun

Local Express and MongoDB application for `party.fun`.

## Prerequisites

Before running the application, make sure you have:

- Node.js installed.
- npm installed. npm normally comes with Node.js.
- MongoDB running locally on your computer.
- The project folder available at:

```powershell
C:\smu heap\party.fun
```

The app is configured in `config.env` to use:

```text
PORT=8000
MONGO_URI=mongodb://127.0.0.1:27017/partyfun
```


Run all npm commands from this folder. If you run them from another folder, npm may not find the correct `package.json`.

## Install dependencies

Run this once after cloning the project or after pulling changes that update dependencies:

```powershell
npm install
```

This installs the packages listed in `package.json`, including Express, EJS, Mongoose, bcrypt, dotenv, and express-session.

It also uses `package-lock.json` to install consistent package versions.

If `node_modules/` is missing, run:

```powershell
npm install
```

again from the project folder.

## Start MongoDB

The app connects to local MongoDB at:

```text
mongodb://127.0.0.1:27017/partyfun
```

Make sure MongoDB is running before starting the app. If MongoDB is not running, the server will fail with a database connection error.

## Run the app

Start the server with:

```powershell
npm start
```

This runs the `start` script from `package.json`:

```text
node server.js
```

You can also run:

```powershell
npm run dev
```

The `dev` script currently runs the same command:

```text
node server.js
```

When the app starts successfully, you should see output similar to:

```text
Server running at http://localhost:8000
MongoDB connected
```

## View the frontend

Do not open `server.js` directly in the browser. This is an Express backend app, so the frontend pages are served through the running Node server.

After starting the server, open these URLs in your browser:

```text
http://localhost:8000/register
http://localhost:8000/login
http://localhost:8000/dashboard
```

The `/dashboard` page is protected. If you are not logged in, it redirects to:

```text
http://localhost:8000/login
```

## Stop the server

If the server is running in your current PowerShell terminal, press:

```powershell
Ctrl + C
```

If the server was started in the background, find the Node process running `server.js`:

```powershell
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -match 'server\.js' }
```

Look for the `ProcessId`, then stop it:

```powershell
Stop-Process -Id PROCESS_ID -Force
```

For example:

```powershell
Stop-Process -Id 1428 -Force
```

## Common npm commands

Install project dependencies:

```powershell
npm install
```

Start the app:

```powershell
npm start
```

Run the development script:

```powershell
npm run dev
```

List available npm scripts:

```powershell
npm run
```

## Troubleshooting

### Port 8000 is already in use

If another server is already using port `8000`, stop the old server first.

Find Node servers:

```powershell
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -match 'server\.js' }
```

Stop the matching process:

```powershell
Stop-Process -Id PROCESS_ID -Force
```

Then run:

```powershell
npm start
```

### MongoDB is not running

If you see a MongoDB connection error, start MongoDB locally and try again:

```powershell
npm start
```

### Dependencies are missing

If you see an error like `Cannot find module`, install dependencies:

```powershell
npm install
```

Then start the server again:

```powershell
npm start
```

### Browser shows nothing when opening files directly

Do not open local files such as `server.js` or `.ejs` files directly in the browser.

Start the server with:

```powershell
npm start
```

Then open:

```text
http://localhost:8000/register
```
