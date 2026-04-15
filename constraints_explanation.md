# Constraints Implementation Summary

This document explains how hard and soft constraints are managed in the Timetable Generator project, covering both the frontend UI and the backend Genetic Algorithm logic.

## 1. Frontend Implementation (`public/index.html` & `public/dashboard.html`)

The frontend allows users to interactively define custom constraints before starting the generation process. These inputs are bound to JavaScript arrays (`hardConstraints` and `softConstraints`) and are saved automatically against the active project via the `autoSave()` API calls to the server. 

### Hard Constraints (Must Be Satisfied)
The user can add "Hard Constraints" which are represented as objects indicating mandatory scheduling rules. The user interface allows four main types:
- **Faculty Unavailability:** User selects a `facultyId`, `day`, and an optional `timeslot`.
- **Room Restriction (`room_restriction`):** User specifies that a specific `courseId` must always happen in a specific `classroom`.
- **Faculty Available First Half Only (`faculty_first_half_only`):** User flags a `facultyId` to only receive morning slots.
- **Faculty Available Second Half Only (`faculty_second_half_only`):** User flags a `facultyId` to only receive afternoon slots.

*Note: The system determines what defines "First Half" and "Second Half" based on the "Break Time" widget configured globally above the constraints.*

### Soft Constraints (Preferred, Weighted)
The user can add "Soft Constraints" representing preferred scheduling properties. Crucially, each soft constraint has a customizable `weight` (defaulting to 50) determining how strictly the algorithm penalizes its violation. Types include:
- **Faculty Prefers First / Second Half:** Similar to the hard constraints, but only penalized with weight, not strictly enforced.
- **No Back-to-Back Same Course:** Optionally scoped by `courseId` (or applies to all if left blank). Instructs the algorithm to avoid creating consecutive timeslots of the exact same subject.
- **Balanced Daily Load:** Flags that faculty members should not have days where their workload far exceeds their daily average.
- **Course Preferred Timeslot:** Scopes a `courseId` to preferentially fall in the "morning", "afternoon", or "last" slot of the day.

When "Generate Timetable" is clicked, everything is bundled and sent via HTTP to the backend server.

---

## 2. Backend Implementation (`ga.js`)

The `GeneticAlgorithm` class processes these custom constraints as part of its fitness evaluation function. The arrays mapped from the frontend dictate exactly how fitness penalties are calculated for each possible "individual" (a complete timetable schedule candidate).

### Hard Constraints
An individual solution is evaluated via the `countHardConflicts()` method. This method tallies foundational structural conflicts (e.g., overlapping faculty assignments, overlapping classroom assignments in the same timeslot) and then invokes `checkHardConstraintViolations()` which iterates over the user-defined `hardConstraints` array:

1. **Faculty Unavailability:** Checks if any chromosome (gene) schedules the flagged faculty on the flagged day (and timeslot/entire day). Every violation increments the `violations` counter.
2. **Room Restriction:** Checks if any gene corresponding to the flagged course is assigned to an incorrect `classroomIdx`. 
3. **Faculty First/Second Half Only:** Uses a pre-computed `firstHalfSlotIndices` (derived from the break time start slot relative to all slots) to strictly enforce boundary timing via `violations++`.

The generated conflict count results in a massive mathematical penalty during the standard calculation: `hardPenalty = conflicts * (maxPossibleScore + 10000)`. Thus, individuals failing hard constraints are almost guaranteed to be rejected. Additionally, the algorithm features a `repairConflicts()` step that proactively rerandomizes specific genes causing these specific hard conflicts on high-performing (elite) solutions.

### Soft Constraints
Evaluated via the `computeSoftPenalty()` method. This method is much more forgiving—it does not reject the schedule outright but applies mathematical weights to grade quality. For every rule in `this.softConstraints`, the algorithm parses the `type`:

1. **Faculty Prefers First / Second Half:** The algorithm cross-checks the mapped genes for that faculty. For each gene that lands on the wrong side of the `firstHalfSlotIndices` set, `penalty += weight`.
2. **No Back-to-Back Same Course:** Gathers slots belonging to the target course for groups belonging to the same standard/day combinations. It sorts the slots, and for any consecutive gap of exactly `1` slot, `penalty += weight`.
3. **Balanced Daily Load:** Computes the total weekly load mapped to `avgLoad` over active days. Any given day where `load > avgLoad + 1` accumulates the penalty.
4. **Course Preferred Slot:** Verifies slot positions. If flagged for "last" but missing the length offset of the `timeSlots` index, or failing the morning/afternoon bounds, `penalty += weight`.

The overall sequence resolves to `fitness = distScore - softPenalty - hardPenalty`. This ensures the algorithm maximizes distribution logic (`distScore`), minimizes minor rule-breaking (`softPenalty`), and completely prevents hard rule-breaking (`hardPenalty`). Finally, `evaluateSoftConstraints()` produces the human-readable summary detailing precisely how often soft constraints succeeded versus failed, driving the "More Details" view back on the dashboard user interface!
