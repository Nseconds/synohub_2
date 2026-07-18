# SynoHub - Fleet Intelligence Frontpage & Portal

A clean, modern, and high-performance React + TypeScript SPA client for the **SynoHub Fleet Operations Portal** (Dubai Operations). 

This portal connects to an Express API backend server (`server.ts`) which manages database operations (adding tickets, tracking leads, editing customer information, and simulated AI Chat) directly on a remote MySQL database configured via environment variables.

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

## ⚡ How the Database & API Integration Works

The frontend works dynamically by proxying API requests to the Express backend server:

1. **Express Backend API (`server.ts`)**:
   - Runs on port `3000` (or the `PORT` specified in `.env`).
   - Connects to the MySQL database configured in `.env`.
   - Seeded/populated with realistic Dubai and UAE-based fleet management clients (e.g., *Emirates Transport*, *Al Futtaim Logistics*), lead logs, and service tickets.
   - Contains handlers for portal authentication, client/lead retrieval, updates, and chat history.

2. **Frontend Development Server (`vite.config.ts` Proxy)**:
   - Vite is configured to proxy all `/api` requests to the Express server running at `http://localhost:3000` (or your configured port).
   - This ensures smooth local development without needing cross-origin configuration (CORS) issues in the browser.

---

## 🚀 Setup & Execution

### 1. Requirements
Ensure you have **Node.js** (v18 or higher) and **npm** installed on your system.

### 2. Configure Environment Variables
Ensure you have a `.env` file in the root directory with the database credentials:
```env
PORT=3000
DB_HOST=<your_db_host>
DB_PORT=3306
DB_USER=<your_db_user>
DB_PASSWORD=<your_db_password>
DB_NAME=<your_db_name>
```

### 3. Installing Dependencies
Install the required packages:
```bash
npm install
```

### 4. Running the Project
To run the project, you must start **both** the backend Express server and the Vite frontend dev server in separate terminal windows:

* **Start the Backend API Server:**
  ```bash
  npm run server
  ```
* **Start the Frontend Dev Server:**
  ```bash
  npm run dev
  ```

Once both servers are running, open the local URL (usually `http://localhost:5173`) in your browser.

### 5. Compiling the Production Bundle
To bundle the frontend into clean, static HTML/CSS/JS files:
```bash
npm run build
```
The optimized bundle will be compiled into the `dist/` directory.

---

## 🔒 Portal Authentication Credentials

The portal is configured to restrict access to only the authorized team accounts listed below.

* **Admin Access**:
  * **Username**: `admin`
  * **Password**: `admin`

* **Staff Access**:
  * **Usernames**: `Shams`, `athul`, `Rasick`, `Shamnad`, `Naseeb`, `Faizal`, `Nisam`, `musthafa`, `vaishakhtech`, `Ajmal`, `Vishal`, `Nishad`, `Deepak`, `umar`, `Celine`, `Rayn`, `Ivy`, `amrutha`, `Midhun`, `shyamjith`, `Sreemol`, `staff`, `Musthafa`, `Falul`, `Sanjith`, `Harshad`, `Moinudeen`, `Shameem`, `ajmal`, `nixon`, `umartech`, `anshad`, `Saad`, `aamil`, `feroz`
  * **Password**: `staff123`


