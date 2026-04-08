# Timetable Generator

A full-stack web application that generates **conflict-free academic timetables** using a Genetic Algorithm (GA). Built for IIIT Vadodara – DIU Campus, it supports multi-user authentication, project-based workflows, configurable hard/soft constraints, and exports to Excel and image formats.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Data Model](#data-model)
- [Authentication System](#authentication-system)
- [Server (server.js)](#server-serverjs)
  - [Middleware & Config](#middleware--config)
  - [Auth Routes](#auth-routes)
  - [Project CRUD Routes](#project-crud-routes)
  - [Timetable Generation Route](#timetable-generation-route)
  - [Validation Pipeline](#validation-pipeline)
  - [Feasibility Check](#feasibility-check)
  - [Solution Formatting](#solution-formatting)
  - [Excel Export](#excel-export)
  - [Output Cleanup](#output-cleanup)
- [Genetic Algorithm (ga.js)](#genetic-algorithm-gajs)
- [Frontend Pages](#frontend-pages)
  - [Login Page (login.html)](#login-page-loginhtml)
  - [Dashboard Page (dashboard.html)](#dashboard-page-dashboardhtml)
  - [Timetable Editor (index.html)](#timetable-editor-indexhtml)
- [Constraint System](#constraint-system)
  - [Hard Constraints](#hard-constraints)
  - [Soft Constraints](#soft-constraints)
- [User Management (adduser.js)](#user-management-adduserjs)
- [API Reference](#api-reference)
- [Data Flow Diagram](#data-flow-diagram)
- [Setup & Running](#setup--running)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                         │
│  ┌──────────┐   ┌───────────────┐   ┌────────────────────────┐ │
│  │login.html│──▶│dashboard.html │──▶│     index.html         │ │
│  │          │   │(project list) │   │  (timetable editor +   │ │
│  │  Auth    │   │ CRUD projects │   │   constraint config +  │ │
│  │  Form    │   │ search/rename │   │   output viewer)       │ │
│  └──────────┘   └───────────────┘   └────────────────────────┘ │
│         │               │                      │               │
│         └───────────────┼──────────────────────┘               │
│                         ▼                                       │
│              sessionStorage (JWT token, email, project ID)      │
└─────────────────────────────────────────────────────────────────┘
                          │  REST API (fetch + Bearer token)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SERVER (Node.js / Express)                  │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  Auth Layer  │  │ Project CRUD │  │ Timetable Generation  │ │
│  │ JWT + bcrypt │  │  (per-user   │  │                       │ │
│  │ domain-lock  │  │   JSON file) │  │ validate → feasibility│ │
│  └──────┬───────┘  └──────┬───────┘  │ → GA.run() → format  │ │
│         │                 │          │ → Excel export        │ │
│         ▼                 ▼          └───────────┬───────────┘ │
│    users.json     data/projects_     output/*.xlsx             │
│                   <email>.json                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Flow:**
1. User logs in via `login.html` → server validates credentials → returns JWT.
2. JWT stored in `sessionStorage`; all subsequent API calls include `Authorization: Bearer <token>`.
3. `dashboard.html` lists/creates/manages projects via `/api/projects` CRUD endpoints.
4. `index.html` loads a specific project, lets user configure inputs + constraints, and calls `/api/generate-timetable`.
5. Server validates inputs, runs the GA, formats the solution, exports Excel, persists output to the project, and returns the schedule JSON.
6. Frontend renders the timetable in multiple views (space-time table, standard-wise, faculty-wise) and offers download options.

---

## Tech Stack

| Layer      | Technology                                                                 |
|------------|---------------------------------------------------------------------------|
| Runtime    | Node.js                                                                   |
| Framework  | Express.js 4.x                                                            |
| Auth       | bcryptjs (password hashing), jsonwebtoken (JWT, 8-hour expiry)            |
| Excel      | ExcelJS (`.xlsx` generation with styled cells, merged rows, color coding) |
| CORS       | cors middleware (credentials enabled)                                     |
| Frontend   | Vanilla HTML/CSS/JS (no framework), IBM Plex Sans/Mono fonts             |
| Image DL   | html2canvas (CDN, lazy-loaded on demand)                                  |
| Storage    | Flat JSON files (no database)                                             |

---

## Directory Structure

```
timetabletest/
├── server.js              # Express server: auth, project CRUD, timetable generation, Excel export
├── ga.js                  # Genetic Algorithm engine (class GeneticAlgorithm)
├── adduser.js             # CLI script to add users to users.json
├── package.json           # Dependencies and npm scripts
├── users.json             # Registered users (email, bcrypt hash, name, role)
├── data/                  # Per-user project data (auto-created)
│   └── projects_<email>.json   # All projects for a specific user
├── output/                # Generated Excel files (auto-created, max 20 retained)
│   └── timetable_<timestamp>.xlsx
└── public/                # Static frontend files served by Express
    ├── login.html         # Authentication page
    ├── dashboard.html     # Project management dashboard
    └── index.html         # Main timetable editor + output viewer (1966 lines)
```

---

## Data Model

### User Object (`users.json`)

```json
{
  "email": "admin@diu.iiitvadodara.ac.in",
  "passwordHash": "$2a$10$...",
  "name": "admin",
  "role": "admin"
}
```

- `role` is stored but not currently used for authorization differentials (all authenticated users have equal access).

### Project Object (`data/projects_<email>.json`)

Each user has a JSON array of projects. A single project contains:

```json
{
  "id": "proj_1712345678901",
  "name": "Semester 5 – CSE",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-02T12:00:00.000Z",

  "standards": [
    {
      "id": "standard-1712345678901",
      "name": "BCA-1",
      "courses": [
        { "id": "course-1712345678902", "name": "Mathematics", "courseCode": "MA101" },
        { "id": "course-1712345678903", "name": "Physics", "courseCode": "PH101" }
      ]
    }
  ],

  "faculty": [
    { "id": "faculty-1712345678904", "name": "Dr. Smith", "facultyCode": "F001" }
  ],

  "assignments": [
    {
      "id": "assignment-1712345678905",
      "courseId": "course-1712345678902",
      "facultyId": "faculty-1712345678904",
      "timesPerWeek": 3
    }
  ],

  "classrooms": ["Room 101", "Room 102", "Lab A"],

  "selectedDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],

  "timeSlotValues": [
    { "startTime": "09:00", "endTime": "10:00" },
    { "startTime": "10:00", "endTime": "11:00" }
  ],

  "breakTime": { "start": "13:00", "end": "14:00" },

  "hardConstraints": [
    { "id": "hard-...", "type": "faculty_unavailability", "facultyId": "faculty-...", "day": "Monday", "timeslot": "09:00" },
    { "id": "hard-...", "type": "room_restriction", "courseId": "course-...", "classroom": "Lab A" },
    { "id": "hard-...", "type": "faculty_first_half_only", "facultyId": "faculty-..." },
    { "id": "hard-...", "type": "faculty_second_half_only", "facultyId": "faculty-..." }
  ],

  "softConstraints": [
    { "id": "soft-...", "type": "faculty_prefers_first_half", "facultyId": "faculty-...", "weight": 50 },
    { "id": "soft-...", "type": "no_back_to_back_course", "courseId": "", "weight": 50 },
    { "id": "soft-...", "type": "balanced_daily_load", "weight": 50 },
    { "id": "soft-...", "type": "course_preferred_slot", "courseId": "course-...", "preference": "morning", "weight": 50 }
  ],

  "scheduleData": { "Monday": [ ... ], "Tuesday": [ ... ] },
  "scheduleStats": { "conflicts": 0, "fitness": "1234.56", "classCount": 30, "softReport": [ ... ] },
  "generatedFilename": "timetable_1712345678901.xlsx"
}
```

### Key Relationships

```
Standard ──1:N──▶ Course
Faculty  ──1:N──▶ Assignment (via facultyId)
Course   ──1:N──▶ Assignment (via courseId)
Assignment ── defines: "Faculty X teaches Course Y, N times per week"
```

### Gene Object (GA internal)

Each gene represents one **class session** to be placed on the timetable:

```json
{
  "assignmentId": "assignment-...",
  "courseId": "course-...",
  "facultyId": "faculty-...",
  "classroomIdx": 0,
  "dayIdx": 2,
  "timeSlotIdx": 1,
  "instance": 0
}
```

- `classroomIdx`, `dayIdx`, `timeSlotIdx` are 0-based indices into their respective arrays.
- `instance` is which occurrence (0 to timesPerWeek-1) this gene represents for a given assignment.

### Formatted Schedule Output

The server returns and stores `scheduleData` as a day-keyed object:

```json
{
  "Monday": [
    {
      "timeSlot": { "startTime": "09:00", "endTime": "10:00" },
      "startTime": "09:00",
      "endTime": "10:00",
      "standard": "BCA-1",
      "course": "Mathematics",
      "courseCode": "MA101",
      "faculty": "Dr. Smith",
      "facultyCode": "F001",
      "classroom": "Room 101"
    }
  ]
}
```

---

## Authentication System

### Mechanism

- **Password Storage**: bcryptjs with 10 salt rounds.
- **Token**: JWT signed with `JWT_SECRET` env var (default: `timetable_secret_change_me_in_production`), expires in **8 hours**.
- **Domain Lock**: Only emails ending with `@diu.iiitvadodara.ac.in` are accepted (enforced both client-side and server-side).
- **Session**: Token is stored in `sessionStorage` (cleared on tab close). No cookies.

### Auth Flow

```
login.html            Server
    │                    │
    │──POST /api/login──▶│  Validates email domain + bcrypt compare
    │◀── { token } ─────│
    │                    │
    │  sessionStorage.setItem('auth_token', token)
    │  redirect → dashboard.html
    │                    │
    │──GET /api/projects─▶│  requireAuth middleware: verifies JWT
    │  Authorization:     │  decodes → req.user = { email, name, role }
    │  Bearer <token>     │
```

### `requireAuth` Middleware

Applied to all protected routes. Extracts `Authorization: Bearer <token>` header, verifies with `jwt.verify()`, attaches `req.user`, or returns 401.

---

## Server (server.js)

**831 lines** — single-file Express server handling auth, CRUD, generation, and export.

### Middleware & Config

| Setting           | Value                          |
|-------------------|--------------------------------|
| Port              | `process.env.PORT` or `5000`   |
| CORS              | All origins, credentials       |
| Body parser       | JSON + URL-encoded, 50MB limit |
| Static files      | `public/` directory            |
| Allowed domain    | `@diu.iiitvadodara.ac.in`      |

### Auth Routes

| Method | Path          | Auth | Purpose                                  |
|--------|---------------|------|------------------------------------------|
| POST   | `/api/login`  | No   | Authenticate user, return JWT            |
| POST   | `/api/logout` | No   | Acknowledge logout (client discards JWT) |
| GET    | `/api/me`     | Yes  | Return current user info from token      |

### Project CRUD Routes

All require `requireAuth`. Projects are stored per-user in `data/projects_<email>.json`.

| Method | Path                | Purpose                                           |
|--------|---------------------|---------------------------------------------------|
| GET    | `/api/projects`     | List all projects (summary, without scheduleData)  |
| GET    | `/api/projects/:id` | Get full project (all inputs + output)              |
| POST   | `/api/projects`     | Create new project (empty template)                 |
| PUT    | `/api/projects/:id` | Update project fields (with uniqueness validation)  |
| DELETE | `/api/projects/:id` | Delete project                                      |

**PUT validation** (before saving):
- Faculty IDs and codes must be unique.
- Standard IDs must be unique.
- Course IDs and codes must be unique across all standards.
- Classroom names must be unique (case-insensitive).

**Allowed fields for PUT**: `name`, `standards`, `faculty`, `assignments`, `classrooms`, `selectedDays`, `timeSlotValues`, `hardConstraints`, `softConstraints`, `breakTime`, `scheduleData`, `scheduleStats`, `generatedFilename`.

### Timetable Generation Route

```
POST /api/generate-timetable   (requires auth)
```

**Request body:**

```json
{
  "projectId": "proj_...",
  "standards": [...],
  "faculty": [...],
  "assignments": [...],
  "classrooms": ["Room 101", ...],
  "daysOfWeek": ["Monday", "Tuesday", ...],
  "timeSlots": [{ "startTime": "09:00", "endTime": "10:00" }, ...],
  "hardConstraints": [...],
  "softConstraints": [...],
  "breakTime": { "start": "13:00", "end": "14:00" }
}
```

**Pipeline:**

```
Request Body
    │
    ▼
validateInput()         ─── checks presence, uniqueness, referential integrity
    │
    ▼
checkFeasibility()      ─── mathematical impossibility detection
    │
    ▼
GeneticAlgorithm.run()  ─── returns best solution { genes, fitness, conflicts }
    │
    ▼
formatSolution()        ─── converts gene indices to readable schedule object
    │
    ▼
createExcelTimetable()  ─── writes styled .xlsx to output/
    │
    ▼
Persist to project      ─── saves scheduleData + stats to user's project JSON
    │
    ▼
Response                ─── { success, filename, stats, data }
```

**Response:**

```json
{
  "success": true,
  "filename": "timetable_1712345678901.xlsx",
  "filepath": "/output/timetable_1712345678901.xlsx",
  "stats": {
    "conflicts": 0,
    "fitness": "1234.56",
    "classCount": 30,
    "softReport": [
      {
        "id": "soft-...",
        "type": "faculty_prefers_first_half",
        "label": "faculty_prefers_first_half",
        "weight": 50,
        "violations": 0,
        "total": 5,
        "satisfied": true,
        "detail": "Dr. Smith: 5/5 classes in first half"
      }
    ]
  },
  "data": {
    "Monday": [ { "startTime": "09:00", "endTime": "10:00", "standard": "BCA-1", "course": "Mathematics", ... } ],
    "Tuesday": [ ... ]
  }
}
```

### Validation Pipeline

`validateInput()` checks (**server.js lines 392–548**):

1. **Presence**: At least 1 standard, faculty, assignment, classroom, day, time slot.
2. **Faculty**: No empty name/id/code, no duplicate IDs, codes, or names.
3. **Standards & Courses**: No empty name/id, no duplicate standard IDs/names, no duplicate course IDs/codes across all standards.
4. **Classrooms**: No empty names, no duplicates (case-insensitive).
5. **Time Slots**: Start < end, no duplicates.
6. **Assignments**: Must reference existing courseId and facultyId, no duplicate course+faculty pairs, timesPerWeek ≥ 1 and ≤ number of selected days.

### Feasibility Check

`checkFeasibility()` performs mathematical checks (**server.js lines 550–646**):

- **Global capacity**: `totalNeeded ≤ classrooms × days × slots`
- **Per-faculty capacity**: Each faculty's total load fits within available slots (accounting for unavailability and first/second half constraints).
- **Per-standard capacity**: A standard can only attend one class per timeslot (regardless of classroom count), so `needed ≤ days × slots`.

Returns `{ isPossible: false, reasons: [...] }` with specific, actionable reasons if impossible.

### Solution Formatting

`formatSolution()` (**server.js lines 648–685**):

- Converts gene indices to human-readable values (day name, time slot object, classroom name, standard name, course name/code, faculty name/code).
- Returns day-keyed object with classes sorted by startTime within each day.

### Excel Export

`createExcelTimetable()` (**server.js lines 702–795**):

- Creates a multi-column worksheet: **Day | Standard | Cap # | TimeSlot1 | TimeSlot2 | ...**
- Merges day cells vertically for multi-standard days.
- Applies color cycling per standard row (4-color palette: peach, blue, green, peach).
- Handles any number of columns via `excelColName()` helper (converts 0-based index to Excel column letters: A, B, ..., Z, AA, AB, ...).
- Row 1 contains a merged info cell with a note about cell duration.

### Output Cleanup

`cleanupOldOutputFiles()` (**server.js lines 801–818**):

- Keeps only the 20 most recent `.xlsx` files in `output/`.
- Called after each new file is created.
- Sorts by modification time, deletes oldest.

---

## Genetic Algorithm (ga.js)

**806 lines** — a self-contained `GeneticAlgorithm` class. Uses a standard evolutionary approach with several documented fixes for performance and correctness.

### Overview

The GA encodes a timetable as a chromosome (array of genes). Each gene maps one assignment instance to a `(classroom, day, timeslot)` tuple. The algorithm evolves a population to minimize hard conflicts and soft penalties while maximizing distribution quality.

### Key Parameters

| Parameter       | Value | Description                                        |
|-----------------|-------|----------------------------------------------------|
| `populationSize`| 80    | Number of individuals per generation               |
| `generations`   | 200   | Max generations per attempt (inner loop hard cap)   |
| `mutationRate`  | 0.15  | Base probability of mutating each gene             |
| `crossoverRate` | 0.85  | Probability of using crossover vs. cloning parent  |
| `eliteSize`     | 5     | Number of best individuals carried to next gen     |
| `tournamentSize`| 4     | Tournament selection pool size                     |
| `MAX_RESTARTS`  | 2     | Fresh population restarts if conflicts persist     |
| `STAGNATION_LIMIT` | 50 | Generations without improvement before escalation  |
| `TIME_LIMIT_MS` | 25000 | Wall-clock hard stop (25 seconds)                  |

### Fitness Function

```
fitness = distributionScore - softPenalty - hardPenalty
```

Where:
- **hardPenalty** = `conflicts × (maxPossibleScore + 10000)` — makes any conflict catastrophically expensive.
- **softPenalty** = weighted sum of soft constraint violations.
- **distributionScore** = rewards spreading assignments across different days and using multiple classrooms.

### Hard Conflict Types Checked

1. **Faculty clash**: Same faculty assigned to two classes at the same day+timeslot.
2. **Classroom clash**: Two classes in the same room at the same day+timeslot.
3. **Standard clash**: Same standard (student group) has two classes at the same day+timeslot.
4. **Hard constraint violations**: faculty_unavailability, room_restriction, faculty_first_half_only, faculty_second_half_only.

### Soft Constraint Penalties

| Type                          | Penalty Condition                                              |
|-------------------------------|----------------------------------------------------------------|
| `faculty_prefers_first_half`  | Gene with matching facultyId is NOT in first-half slot         |
| `faculty_prefers_second_half` | Gene with matching facultyId IS in first-half slot             |
| `no_back_to_back_course`      | Same course for same standard on consecutive slots, same day   |
| `balanced_daily_load`         | Faculty has more than `avgLoad + 1` classes on any single day  |
| `course_preferred_slot`       | Course not in preferred time (morning/afternoon/last slot)     |

### Key Algorithmic Features

- **Conflict Repair** (`repairConflicts()`): After selecting elites, re-assigns conflicting genes randomly (up to 20 attempts per individual). Dramatically reduces conflict count in carried-over elites.
- **Adaptive Mutation**: When stuck with conflicts beyond the stagnation limit, mutation rate triples (capped at 0.5) and mutates multiple gene fields simultaneously.
- **Random Crossover Point**: Uses a random cut-point (not midpoint) for single-point crossover.
- **Fresh Injection**: When deeply stuck, 30% of the new population is replaced with fresh random individuals.
- **Wall-Clock Safety**: Hard 25-second timeout prevents server/browser hangs.
- **Pre-computed Caches**: Course → standard lookup maps, classroom name → index maps, and first-half slot indices are computed once at construction for O(1) access during fitness evaluation.

### Soft Constraint Report

`evaluateSoftConstraints()` produces a post-generation report:

```json
{
  "id": "soft-...",
  "type": "faculty_prefers_first_half",
  "label": "faculty_prefers_first_half",
  "weight": 50,
  "violations": 1,
  "total": 5,
  "satisfied": false,
  "detail": "Dr. Smith: 4/5 classes in first half"
}
```

---

## Frontend Pages

### Login Page (`login.html`)

**321 lines.** Minimal dark-themed login form.

- **Domain validation**: Client-side check for `@diu.iiitvadodara.ac.in` before sending request.
- **Password toggle**: Show/hide password button.
- **Auto-redirect**: If `sessionStorage` already has a token, redirects to `dashboard.html`.
- **Loading spinner**: Inline spinner in submit button during API call.
- **On success**: Stores `auth_token` and `auth_email` in `sessionStorage`, redirects to dashboard after 800ms.

### Dashboard Page (`dashboard.html`)

**701 lines.** Project management UI.

**Components:**
- **Top nav bar**: Brand logo, user email chip, sign-out button.
- **Page header**: "Your Projects" title + "New Project" button.
- **Search bar**: Real-time project name filtering.
- **Projects grid**: Responsive card grid (`repeat(auto-fill, minmax(300px, 1fr))`).
- **Project cards**: Show name, last modified date, status badge ("Generated" or "Draft"), gradient top accent on hover. Each card has a `⋯` menu with: Rename, Duplicate, Delete.
- **New Project modal**: Name input with Enter key support.
- **Rename modal**: Pre-filled with current name.
- **Empty state**: Shown when no projects exist or search yields no results.
- **Toast notifications**: Bottom-right slide-up notifications for actions.

**Data flow:**
1. On load, calls `GET /api/projects` to fetch project summaries.
2. Clicking a card sets `sessionStorage.active_project_id` and navigates to `index.html`.
3. Creating a project → `POST /api/projects` → navigate to editor.
4. Duplicate → fetch full project → create new → copy all fields via PUT.
5. Delete → confirm dialog → `DELETE /api/projects/:id`.

### Timetable Editor (`index.html`)

**1966 lines.** The main application page. A single-page form with multiple sections, all rendered with vanilla JS DOM manipulation.

**Sections (top to bottom):**

1. **Project Bar** (conditional): Shows when a project is loaded. Includes "← Dashboard" link, project name, auto-save status indicator.

2. **Academic Standards & Courses**: Dynamic card-based input. Each standard has nested course sub-cards. Courses have a name and a courseCode. Adding/removing a standard or course propagates to the assignment dropdowns.

3. **Faculty Members**: Card per faculty with name and facultyCode fields.

4. **Classrooms**: Simple card per classroom with name input.

5. **Time Slots**: Dynamic start/end time pairs. Minimum one slot required.

6. **Days of Week**: Checkbox group (Monday–Sunday).

7. **Course Assignments**: Each assignment links a course to a faculty member with a `timesPerWeek` count. Course dropdown filters out already-assigned courses. Faculty dropdown shows all faculty.

8. **Custom Constraints**:
   - **Break Time**: Set break start/end to define "first half" vs "second half".
   - **Hard Constraints**: Dynamically-typed cards. Type selector changes the fields shown.
   - **Soft Constraints**: Similar dynamic cards with an additional weight input (1–200).

9. **Generate Button**: Triggers the full validation → API call → render pipeline.

10. **Loading Indicator**: Spinner shown during generation.

11. **Output Section** (hidden until generated):
    - **Space-Time Table**: Full schedule in a flat table (Day | Standard | Subject | Faculty | Classroom | Time).
    - **Standard-wise Timetables**: Per-standard grid (Time × Day) with Generate/Excel/Image buttons per standard.
    - **Faculty-wise Timetables**: Dropdown to select faculty → generates their personal grid (Time × Day). Each faculty card has CSV and Image download buttons.
    - **More Details**: Collapsible panel with:
      - Stat cards: Conflicts, Fitness Score, Total Classes.
      - Soft Constraint Results: Per-constraint satisfaction status with violations count.
      - Hard Constraint Status: Per-constraint pass/fail indicators.
    - **Download actions**: Download Excel (.xlsx), Download as Image (PNG via html2canvas), New Timetable (reset).

12. **Impossible Timetable Panel**: Shown (instead of output) when feasibility check fails, with specific reasons listed.

**Auto-save system**:
- Every input change calls `markDirty()` → debounced 2-second timer → `autoSave()` → `PUT /api/projects/:id`.
- Save status shows in project bar: "● Unsaved" → "↑ Saving…" → "✓ Saved".

**Project loading**:
- On page load, `loadProjectData()` checks `sessionStorage.active_project_id`.
- If a project ID exists, fetches the full project from the server and rebuilds the entire form (standards, courses, faculty, classrooms, days, time slots, assignments, constraints, break time).
- If the project had a previously generated timetable (`scheduleData`), it restores the output section with all views.

---

## Constraint System

### Hard Constraints

Hard constraints **must** be satisfied — any violation counts as a conflict. The GA receives a massive fitness penalty for each violation.

| Type                        | Config Fields            | Effect                                               |
|-----------------------------|--------------------------|------------------------------------------------------|
| `faculty_unavailability`    | facultyId, day, timeslot | Faculty cannot be scheduled at the given day/slot. If timeslot is empty → entire day blocked. |
| `room_restriction`          | courseId, classroom      | Course MUST use the specified classroom for all instances. |
| `faculty_first_half_only`   | facultyId                | Faculty can only be scheduled in slots before the break time. |
| `faculty_second_half_only`  | facultyId                | Faculty can only be scheduled in slots after the break time. |

### Soft Constraints

Soft constraints are **preferences**. Violations add a weighted penalty to the fitness score but don't make the timetable "invalid."

| Type                          | Config Fields            | Weight | Effect                                              |
|-------------------------------|--------------------------|--------|-----------------------------------------------------|
| `faculty_prefers_first_half`  | facultyId                | 1–200  | Penalty for each class NOT in first half             |
| `faculty_prefers_second_half` | facultyId                | 1–200  | Penalty for each class IN first half                 |
| `no_back_to_back_course`      | courseId (optional)       | 1–200  | Penalty for consecutive same-course slots. If courseId is empty, applies to ALL courses. |
| `balanced_daily_load`         | (global)                 | 1–200  | Penalty when a faculty's daily load exceeds avg + 1  |
| `course_preferred_slot`       | courseId, preference      | 1–200  | Preference options: `morning`, `afternoon`, `last`  |

### Break Time

The break time (`breakTime.start`) defines the boundary:
- **First half**: time slots where `startTime < breakTime.start`
- **Second half**: time slots where `startTime >= breakTime.start`

---

## User Management (adduser.js)

CLI script to add users to `users.json`:

```bash
node adduser.js admin@diu.iiitvadodara.ac.in MyPassword123
```

- Validates domain suffix.
- Checks for duplicate emails.
- Hashes password with bcrypt (10 rounds).
- Appends to `users.json` with `role: "user"` (name derived from email prefix).

---

## API Reference

### Public Routes

| Method | Endpoint       | Body                    | Response                                   |
|--------|----------------|-------------------------|--------------------------------------------|
| POST   | `/api/login`   | `{ email, password }`   | `{ success, token, email, name }`          |
| POST   | `/api/logout`  | —                       | `{ success, message }`                     |
| GET    | `/api/health`  | —                       | `{ status: "Server running on port 5000" }`|

### Protected Routes (require `Authorization: Bearer <token>`)

| Method | Endpoint                      | Body                                                                   | Response                                          |
|--------|-------------------------------|------------------------------------------------------------------------|---------------------------------------------------|
| GET    | `/api/me`                     | —                                                                      | `{ success, user: { email, name, role } }`        |
| GET    | `/api/projects`               | —                                                                      | `{ success, projects: [{ id, name, createdAt, updatedAt, hasOutput }] }` |
| GET    | `/api/projects/:id`           | —                                                                      | `{ success, project: { ...full project... } }`    |
| POST   | `/api/projects`               | `{ name }`                                                              | `{ success, project: { ...new project... } }`     |
| PUT    | `/api/projects/:id`           | Any allowed fields                                                      | `{ success, project: { ...updated project... } }` |
| DELETE | `/api/projects/:id`           | —                                                                      | `{ success: true }`                               |
| POST   | `/api/generate-timetable`     | See [Timetable Generation Route](#timetable-generation-route)           | `{ success, filename, filepath, stats, data }`    |
| GET    | `/output/:filename`           | —                                                                      | File download (.xlsx) with path traversal guard    |

### Error Response Format

```json
{
  "success": false,
  "error": "Human-readable error message",
  "errors": ["Validation error 1", "Validation error 2"],
  "impossible": true,
  "reasons": ["Feasibility reason 1", "Feasibility reason 2"]
}
```

- `errors` array: present for validation failures.
- `impossible` + `reasons`: present for feasibility failures.

---

## Data Flow Diagram

### Timetable Generation Pipeline

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Frontend   │────▶│   validateInput  │────▶│ checkFeasibility │
│  (index.html │     │                  │     │                  │
│   collects   │     │ • presence       │     │ • capacity check │
│   all inputs)│     │ • uniqueness     │     │ • per-faculty    │
│              │     │ • referential    │     │ • per-standard   │
│              │     │   integrity      │     │ • unavailability │
└──────────────┘     └────────┬─────────┘     └────────┬─────────┘
                              │ errors?                 │ impossible?
                              ▼                         ▼
                         400 response              400 response
                          with errors        with reasons + panel

                    (if both pass) ──────────────────────┐
                                                         ▼
┌──────────────────┐     ┌──────────────────┐    ┌──────────────┐
│  formatSolution  │◀────│  GA.run()        │◀───│ new GA(...)  │
│                  │     │                  │    │ constructor  │
│ indices → names  │     │ population init  │    │ pre-computes │
│ day-keyed object │     │ evaluate+sort    │    │ caches, maps │
│ sorted by time   │     │ selection        │    └──────────────┘
│                  │     │ crossover        │
└────────┬─────────┘     │ mutation         │
         │               │ repair           │
         ▼               │ restart          │
┌──────────────────┐     │ time limit       │
│createExcelTable  │     └──────────────────┘
│                  │
│ ExcelJS workbook │
│ styled cells     │
│ merged rows      │
│ color coding     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│  Save to project │────▶│  Response JSON   │
│  (if projectId)  │     │  { data, stats,  │
│                  │     │    filename }     │
└──────────────────┘     └──────────────────┘
```

### Frontend State Management

```
sessionStorage
├── auth_token      ◀── set by login.html, read by all pages
├── auth_email      ◀── set by login.html, shown in dashboard nav
└── active_project_id ◀── set by dashboard.html, read by index.html

index.html in-memory state (JS globals):
├── standards[]       ◀── synced to UI + auto-saved to server
├── faculty[]         ◀── synced to UI + auto-saved to server
├── assignments[]     ◀── synced to UI + auto-saved to server
├── selectedDays[]    ◀── synced to UI + auto-saved to server
├── timeSlotValues[]  ◀── synced to UI + auto-saved to server
├── hardConstraints[] ◀── synced to UI + auto-saved to server
├── softConstraints[] ◀── synced to UI + auto-saved to server
├── breakTime {}      ◀── synced to UI + auto-saved to server
├── currentScheduleData  ◀── populated after generation / project load
└── generatedFilename    ◀── used for Excel download link
```

---

## Setup & Running

### Prerequisites

- Node.js (v16+)

### Install

```bash
cd timetabletest
npm install
```

### Add Users

```bash
node adduser.js yourname@diu.iiitvadodara.ac.in YourPassword
```

### Run

```bash
npm start
# or
node server.js
```

Server starts on `http://localhost:5000`.

### Environment Variables

| Variable     | Default                                      | Description                |
|--------------|----------------------------------------------|----------------------------|
| `PORT`       | `5000`                                       | HTTP listen port           |
| `JWT_SECRET` | `timetable_secret_change_me_in_production`   | JWT signing secret         |

### Access

1. Open `http://localhost:5000` → redirects to `login.html`.
2. Log in with a registered email.
3. Create a project from the dashboard.
4. Configure standards, courses, faculty, classrooms, time slots, days, and constraints.
5. Click "Generate Timetable".
6. View results in multiple formats, download as Excel or image.
