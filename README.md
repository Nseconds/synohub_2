# SynoHub - Fleet Intelligence Frontpage & Portal

A clean, modern, and high-performance React + TypeScript SPA client for the **SynoHub Fleet Operations Portal** (Dubai Operations). 

This portal has been replicated and optimized to run **completely client-side**. It requires **zero backend servers or database configurations** to run. All database operations (adding tickets, tracking leads, editing customer information, and simulated AI Chat) are handled in the browser via an interactive local-storage database mock layer.

---

## 📂 Project Structure

The project has been refactored into a highly optimized, standard frontend structure:

```bash
synohub_2/
├── dist/                    # Compiled production-ready bundle assets
├── node_modules/            # Frontend packages & dependencies
├── src/
│   ├── components/
│   │   └── LoginForm.tsx    # Portal Authentication Frontpage Form
│   ├── frontend/
│   │   ├── api/
│   │   │   ├── apiClient.ts  # Client-side Mock Database and Seed Engine
│   │   │   ├── authApi.ts    # Authentication API wrapper
│   │   │   ├── chatApi.ts    # SynoAI Cog-Ops Chat API wrapper
│   │   │   ├── customerApi.ts# Customer Account actions wrapper
│   │   │   ├── dashboardApi.ts# Dashboard Activity feed wrapper
│   │   │   └── serviceRequestApi.ts # Leads and Tickets API wrapper
│   │   ├── components/      # UI Layout wrappers and components
│   │   │   ├── AppBoundary.tsx      # Lifecycle crash catcher
│   │   │   ├── AppLayout.tsx        # Grid dashboard wrapper
│   │   │   ├── EditModal.tsx        # DB Viewer Modal
│   │   │   ├── Header.tsx           # Search bar & Status indicator
│   │   │   ├── Modal.tsx            # Overlay layout popup
│   │   │   ├── NotificationToast.tsx# Success/Error toast alerts
│   │   │   ├── Sidebar.tsx          # Navigation menu and active profile
│   │   │   └── ChatInterface.tsx    # Neural Chat Controller
│   │   ├── constants/
│   │   │   └── options.ts   # Selector dropdown static values
│   │   ├── pages/           # Portal Views
│   │   │   ├── LoginPage.tsx        # Auth page wrapper
│   │   │   ├── DashboardPage.tsx    # Activity Feed and statistics
│   │   │   ├── AddServicePage.tsx   # Lead registration/service ticket form
│   │   │   ├── CustomersPage.tsx    # Client accounts table
│   │   │   ├── AiPage.tsx           # Cog-Ops page wrapper
│   │   │   └── ChatPage.tsx         # Chat console layout
│   │   ├── types/           # TypeScript Domain types & Interfaces
│   │   │   ├── index.ts
│   │   │   ├── chat.ts
│   │   │   ├── customer.ts
│   │   │   └── serviceRequest.ts
│   │   └── utils/
│   │       └── auth.ts      # Auth validation helpers
│   │   └── lib/
│   │       └── utils.ts     # Tailwind merge utility (cn)
│   ├── App.tsx              # Main state manager & page orchestrator
│   ├── index.css            # Tailwind theme configuration
│   └── main.tsx             # Application entry point and Fetch Interceptor
├── package.json             # Bundler scripts and package manifest
├── tsconfig.json            # TypeScript compile options
├── vite.config.ts           # Vite Bundler settings
└── index.html               # Entry DOM element page
```

---

## ⚡ How the Client-Side API Mock Layer Works

To avoid complex backend configurations and database setups, the frontend works dynamically out-of-the-box using two features:

1. **Local-Storage Mock DB (`src/frontend/api/apiClient.ts`)**:
   - On the first load, the app seeds `localStorage` with a mock dataset containing realistic Dubai and UAE-based fleet management clients (e.g., *Emirates Transport*, *Al Futtaim Logistics*), lead logs, and service tickets.
   - Any requests to save leads, modify tickets, or perform customer searches write directly to `localStorage.getItem("synohub_mock_db")`, making the app fully interactive and persistent.

2. **Global Fetch Interceptor (`src/main.tsx`)**:
   - Any component making direct `fetch()` calls (like the chat user lists query `/api/users`) is automatically intercepted at the window level.
   - The interceptor routes the request to our mock API client and returns a standard HTTP-like `Response` object. This prevents any network leak errors or connection failures.

---

## 🚀 Setup & Execution

### 1. Requirements
Ensure you have **Node.js** (v18 or higher) and **npm** installed on your system.

### 2. Installing Dependencies
Install the required React, Tailwind, and Vite packages:
```bash
npm install
```

### 3. Running the Development Server
Launch the local Vite server:
```bash
npm run dev
```
Once the dev server starts, open the local URL (usually `http://localhost:5173`) in your browser.

### 4. Compiling the Production Bundle
To bundle the frontend into clean, static HTML/CSS/JS files:
```bash
npm run build
```
The optimized bundle will be compiled into the `dist/` directory, which can be deployed to any static host (such as Vercel, Netlify, or AWS S3).

---

## 🔒 Portal Authentication Credentials

The portal is configured to restrict access to only the authorized team accounts listed below.

* **Admin Access**:
  * **Username**: `admin`
  * **Password**: `admin`

* **Staff Access**:
  * **Usernames**: `Shams`, `athul`, `Rasick`, `Shamnad`, `Naseeb`, `Faizal`, `Nisam`, `musthafa`, `vaishakhtech`, `Ajmal`, `Vishal`, `Nishad`, `Deepak`, `umar`, `Celine`, `Rayn`, `Ivy`, `amrutha`, `Midhun`, `shyamjith`, `Sreemol`, `staff`, `Musthafa`, `Falul`, `Sanjith`, `Harshad`, `Moinudeen`, `Shameem`, `ajmal`, `nixon`, `umartech`, `anshad`, `Saad`, `aamil`, `feroz`
  * **Password**: `staff123`

---

## 🛠️ Transitioning to a Real Backend API

When you are ready to scale and connect this frontend to a real API, the process is simple:

1. **Remove the Fetch Interceptor**:
   - Delete the `window.fetch` interceptor block at the top of [src/main.tsx](file:///var/files/feros/synohub_2/src/main.tsx).
2. **Restore Real HTTP client**:
   - Revert [src/frontend/api/apiClient.ts](file:///var/files/feros/synohub_2/src/frontend/api/apiClient.ts) to perform standard network requests using `window.fetch` (pointing to your server base URL).
3. **Set Environment Variables**:
   - Add your API gateway host to your environment config.
