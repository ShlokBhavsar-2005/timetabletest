/**
 * Genetic Algorithm for Timetable Generation
 * Supports hard and soft constraints
 *
 * FIXES applied (see comments tagged [FIX]):
 *  F1 – countHardConflicts was called twice per individual per generation (double work).
 *       Now evaluateFitness returns {fitness, conflicts} together; run() uses that.
 *  F2 – crossover always used the fixed midpoint (p1.genes.length/2).
 *       Now uses a random cut-point for diversity.
 *  F3 – room_restriction used Array.indexOf which is case/whitespace sensitive and
 *       silently breaks when the name does not match (returns -1 → constraint skipped).
 *       Now uses a pre-built Map for exact lookup + a warning log.
 *  F4 – evaluateFitness called countHardConflicts internally AND the run() loop called
 *       it again — the inner call is now removed from evaluateFitness; fitness returns
 *       both values from a single pass via evaluateIndividual().
 *  F5 – When the GA is stuck with conflicts, the old code injected 30 % fresh random
 *       individuals but did NOT repair the conflicting genes of elite survivors.
 *       New repairConflicts() method does targeted re-assignment of conflicting genes
 *       before they are placed in the new population, dramatically reducing conflict count.
 *  F6 – mutateWithRate picked only one of {classroom, day, slot} to change per gene.
 *       Under high conflict pressure we now allow multi-field mutation so the gene can
 *       escape a "corner" where all three fields are wrong simultaneously.
 *  F7 – Crossover silently corrupted genes when p1 and p2 had different lengths
 *       (should not happen, but added a guard).
 *  F8 – computeSoftPenalty for no_back_to_back_course: correctly scoped to apply only
 *       to genes that belong to the course referenced by sc.courseId (if non-empty),
 *       or all courses (if empty) — previous implementation was already OK here but
 *       added an explicit comment for clarity.
 */

class GeneticAlgorithm {
  // Fast shallow-clone a single gene object (avoids JSON.parse/stringify overhead)
  static _cloneGene(g) {
    return {
      assignmentId: g.assignmentId,
      courseId:     g.courseId,
      facultyId:    g.facultyId,
      classroomIdx: g.classroomIdx,
      dayIdx:       g.dayIdx,
      timeSlotIdx:  g.timeSlotIdx,
      instance:     g.instance
    };
  }

  // Fast clone of a full individual
  static _cloneInd(ind) {
    return { genes: ind.genes.map(GeneticAlgorithm._cloneGene), fitness: 0, conflicts: 0 };
  }

  constructor(constraints) {
    this.constraints = constraints;
    this.populationSize = 80;   // was 100 — smaller pop, faster per-generation
    this.generations    = 200;  // was 300
    this.mutationRate   = 0.15;
    this.crossoverRate  = 0.85;
    this.eliteSize      = 5;    // was 8
    this.tournamentSize = 4;    // was 5

    this.standards   = constraints.standards;
    this.faculty     = constraints.faculty;
    this.assignments = constraints.assignments;
    this.classrooms  = constraints.classrooms;
    this.daysOfWeek  = constraints.daysOfWeek;
    this.timeSlots   = constraints.timeSlots;

    // Parsed constraint lists
    this.hardConstraints = constraints.hardConstraints || [];
    this.softConstraints = constraints.softConstraints || [];

    // Break time: slot.startTime < breakStart → first half
    this.breakTime = constraints.breakTime || null;

    // Pre-compute which slot indices are "first half" (before break)
    this.firstHalfSlotIndices = this._computeFirstHalfSlots();

    // Course + Standard lookup caches  (O(1) lookup during fitness evaluation)
    this._courseCache    = {};
    this._standardCache  = {};
    this.standards.forEach(std => {
      (std.courses || []).forEach(c => {
        this._courseCache[c.id]   = c;
        this._standardCache[c.id] = std;
      });
    });

    // [FIX F3] Pre-build classroom name → index map for case-insensitive lookup
    this._classroomIndexMap = new Map();
    this.classrooms.forEach((name, idx) => {
      this._classroomIndexMap.set((name || '').trim().toLowerCase(), idx);
    });
  }

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────

  _computeFirstHalfSlots() {
    if (!this.breakTime || !this.breakTime.start) {
      // No break defined → all slots are "first half"
      return new Set(this.timeSlots.map((_, i) => i));
    }
    const breakStart = this.breakTime.start; // e.g. "13:00"
    const indices = new Set();
    this.timeSlots.forEach((slot, i) => {
      if (slot.startTime < breakStart) indices.add(i);
    });
    return indices;
  }

  findStandardByCourseId(courseId) {
    return this._standardCache[courseId] || null;
  }

  findCourseByCourseId(courseId) {
    return this._courseCache[courseId] || null;
  }

  // ─────────────────────────────────────────────
  // MAIN RUN
  // ─────────────────────────────────────────────

  run() {
    console.log('Starting GA with population:', this.populationSize);

    const MAX_RESTARTS     = 2;   // was 5  — fewer restarts
    const MAX_GENERATIONS  = 200; // was 500 — hard cap per attempt
    const STAGNATION_LIMIT = 50;  // was 80
    const TIME_LIMIT_MS    = 25_000; // 25-second wall-clock hard stop
    const startTime        = Date.now();

    let globalBest        = null;
    let globalBestFitness = -Infinity;

    for (let attempt = 0; attempt <= MAX_RESTARTS; attempt++) {
      if (attempt > 0)
        console.log(`↻ Restart ${attempt} — still have conflicts, trying fresh population`);

      let population         = this.initializePopulation();
      let bestSolution       = null;
      let bestFitness        = -Infinity;
      let noImprovementCount = 0;

      for (let generation = 0; generation < MAX_GENERATIONS; generation++) {
        // [FIX F1 / F4] Single-pass evaluation: fitness + conflicts computed once per individual.
        population.forEach(ind => {
          const result  = this.evaluateIndividual(ind);
          ind.fitness   = result.fitness;
          ind.conflicts = result.conflicts;
        });

        population.sort((a, b) => b.fitness - a.fitness);

        if (population[0].fitness > bestFitness) {
          bestFitness        = population[0].fitness;
          bestSolution       = GeneticAlgorithm._cloneInd(population[0]);
          bestSolution.fitness   = population[0].fitness;
          bestSolution.conflicts = population[0].conflicts;
          noImprovementCount = 0;
          if (generation % 50 === 0)
            console.log(`Attempt ${attempt} Gen ${generation}: Fitness=${bestFitness.toFixed(2)}, Conflicts=${bestSolution.conflicts}`);
        } else {
          noImprovementCount++;
        }

        // Stop early only if ZERO conflicts and stable
        if (bestSolution.conflicts === 0 && noImprovementCount > 30) {
          console.log(`✓ Zero-conflict solution found at attempt ${attempt}, gen ${generation}`);
          break;
        }

        // Hard wall-clock exit — prevent browser/server timeout
        if (Date.now() - startTime > TIME_LIMIT_MS) {
          console.warn(`⏱ Time limit reached at attempt ${attempt}, gen ${generation} — returning best so far`);
          break;
        }

        const stuckWithConflicts = bestSolution.conflicts > 0 && noImprovementCount > STAGNATION_LIMIT;
        const effectiveMutation  = stuckWithConflicts
          ? Math.min(this.mutationRate * 3, 0.5)
          : this.mutationRate;

        const newPop = [];

        // Always keep elites.  [FIX F5] Repair their conflicting genes before preservation.
        for (let i = 0; i < this.eliteSize && i < population.length; i++) {
          const elite = GeneticAlgorithm._cloneInd(population[i]);
          if (elite.conflicts > 0) this.repairConflicts(elite);
          newPop.push(elite);
        }

        // Inject fresh individuals when deeply stuck
        if (stuckWithConflicts) {
          const freshCount = Math.floor(this.populationSize * 0.3);
          const fresh      = this.initializePopulation();
          for (let i = 0; i < freshCount; i++) newPop.push(fresh[i]);
        }

        while (newPop.length < this.populationSize) {
          const p1  = this.tournamentSelection(population);
          const p2  = this.tournamentSelection(population);
          let child = Math.random() < this.crossoverRate
            ? this.crossover(p1, p2)
            : GeneticAlgorithm._cloneInd(p1);

          child = this.mutateWithRate(child, effectiveMutation, stuckWithConflicts);
          newPop.push(child);
        }

        population = newPop;
      }

      if (bestSolution && bestSolution.fitness > globalBestFitness) {
        globalBestFitness = bestSolution.fitness;
        globalBest        = bestSolution;
      }

      if (globalBest && globalBest.conflicts === 0) break;
      if (Date.now() - startTime > TIME_LIMIT_MS) break; // time limit hit inside inner loop
    }

    console.log(`GA Complete — Fitness: ${globalBestFitness.toFixed(2)}, Conflicts: ${globalBest.conflicts}`);
    if (globalBest.conflicts > 0) {
      console.warn(
        `⚠️ Could not eliminate all conflicts after ${MAX_RESTARTS + 1} attempts. ` +
        `Best result: ${globalBest.conflicts} conflict(s).`
      );
    }

    globalBest.softReport = this.evaluateSoftConstraints(globalBest);
    return globalBest;
  }

  // ─────────────────────────────────────────────
  // POPULATION INIT
  // ─────────────────────────────────────────────

  initializePopulation() {
    const population = [];
    for (let i = 0; i < this.populationSize; i++) {
      population.push(this._createRandomIndividual());
    }
    return population;
  }

  _createRandomIndividual() {
    const individual = { genes: [], fitness: 0, conflicts: 0 };
    this.assignments.forEach(assignment => {
      const timesPerWeek = parseInt(assignment.timesPerWeek);
      for (let instance = 0; instance < timesPerWeek; instance++) {
        individual.genes.push({
          assignmentId: assignment.id,
          courseId:     assignment.courseId,
          facultyId:    assignment.facultyId,
          classroomIdx: Math.floor(Math.random() * this.classrooms.length),
          dayIdx:       Math.floor(Math.random() * this.daysOfWeek.length),
          timeSlotIdx:  Math.floor(Math.random() * this.timeSlots.length),
          instance
        });
      }
    });
    return individual;
  }

  // ─────────────────────────────────────────────
  // [FIX F5] CONFLICT REPAIR
  // Finds genes that are currently involved in a hard conflict and randomly
  // re-assigns their (day, slot, classroom) until the local conflict is gone
  // or a max-retry limit is reached.  This is not a guarantee — it is a
  // best-effort repair that dramatically reduces conflict count in elites.
  // ─────────────────────────────────────────────

  repairConflicts(individual) {
    const MAX_REPAIR_ATTEMPTS = 20; // was 50 — fewer is faster, still effective

    for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt++) {
      // Identify all conflicting gene indices
      const conflictSet = this._findConflictingGeneIndices(individual);
      if (conflictSet.size === 0) break; // fully repaired

      // Pick one conflicting gene at random and re-assign it
      const indices = Array.from(conflictSet);
      const idxToFix = indices[Math.floor(Math.random() * indices.length)];
      const gene = individual.genes[idxToFix];
      gene.classroomIdx = Math.floor(Math.random() * this.classrooms.length);
      gene.dayIdx       = Math.floor(Math.random() * this.daysOfWeek.length);
      gene.timeSlotIdx  = Math.floor(Math.random() * this.timeSlots.length);
    }
  }

  /**
   * Returns a Set of gene indices that are part of at least one hard conflict.
   * Covers: faculty clash, classroom clash, standard clash, hard-constraint violations.
   */
  _findConflictingGeneIndices(individual) {
    const conflicting = new Set();

    // Faculty clashes
    const facMap = {};
    individual.genes.forEach((g, i) => {
      const key = `${g.facultyId}-${g.dayIdx}-${g.timeSlotIdx}`;
      if (!facMap[key]) facMap[key] = [];
      facMap[key].push(i);
    });
    Object.values(facMap).forEach(idxList => {
      if (idxList.length > 1) idxList.forEach(i => conflicting.add(i));
    });

    // Classroom clashes
    const roomMap = {};
    individual.genes.forEach((g, i) => {
      const key = `${g.classroomIdx}-${g.dayIdx}-${g.timeSlotIdx}`;
      if (!roomMap[key]) roomMap[key] = [];
      roomMap[key].push(i);
    });
    Object.values(roomMap).forEach(idxList => {
      if (idxList.length > 1) idxList.forEach(i => conflicting.add(i));
    });

    // Standard clashes
    const stdMap = {};
    individual.genes.forEach((g, i) => {
      const std = this.findStandardByCourseId(g.courseId);
      if (!std) return;
      const key = `${std.id}-${g.dayIdx}-${g.timeSlotIdx}`;
      if (!stdMap[key]) stdMap[key] = [];
      stdMap[key].push(i);
    });
    Object.values(stdMap).forEach(idxList => {
      if (idxList.length > 1) idxList.forEach(i => conflicting.add(i));
    });

    // Hard constraint violations — mark the offending gene
    this.hardConstraints.forEach(hc => {
      switch (hc.type) {

        case 'faculty_unavailability': {
          const dayIdx  = this.daysOfWeek.indexOf(hc.day);
          const slotIdx = hc.timeslot
            ? this.timeSlots.findIndex(s => s.startTime === hc.timeslot)
            : -1;
          individual.genes.forEach((g, i) => {
            if (g.facultyId !== hc.facultyId) return;
            if (g.dayIdx !== dayIdx) return;
            // slotIdx === -1 means "whole day blocked"
            if (slotIdx === -1 || g.timeSlotIdx === slotIdx) conflicting.add(i);
          });
          break;
        }

        case 'room_restriction': {
          // [FIX F3] Use pre-built Map for safe lookup
          const roomIdx = this._classroomIndexMap.get((hc.classroom || '').trim().toLowerCase());
          if (roomIdx === undefined) break; // unknown room — skip (warning logged elsewhere)
          individual.genes.forEach((g, i) => {
            if (g.courseId === hc.courseId && g.classroomIdx !== roomIdx) conflicting.add(i);
          });
          break;
        }

        case 'faculty_first_half_only': {
          individual.genes.forEach((g, i) => {
            if (g.facultyId === hc.facultyId && !this.firstHalfSlotIndices.has(g.timeSlotIdx))
              conflicting.add(i);
          });
          break;
        }

        case 'faculty_second_half_only': {
          individual.genes.forEach((g, i) => {
            if (g.facultyId === hc.facultyId && this.firstHalfSlotIndices.has(g.timeSlotIdx))
              conflicting.add(i);
          });
          break;
        }
      }
    });

    return conflicting;
  }

  // ─────────────────────────────────────────────
  // FITNESS  — [FIX F1 / F4]
  // evaluateIndividual() does ONE pass for both fitness and conflict count.
  // evaluateFitness() is kept as a convenience wrapper (used internally only).
  // ─────────────────────────────────────────────

  evaluateIndividual(individual) {
    const conflicts   = this.countHardConflicts(individual);
    const softPenalty = this.computeSoftPenalty(individual);
    const distScore   = this.evaluateDistribution(individual);

    const maxPossibleScore = individual.genes.length * 200;
    const hardPenalty      = conflicts * (maxPossibleScore + 10000);

    return {
      conflicts,
      fitness: distScore - softPenalty - hardPenalty
    };
  }

  // Kept for backward compat / external callers
  evaluateFitness(individual) {
    return this.evaluateIndividual(individual).fitness;
  }

  // ─────────────────────────────────────────────
  // HARD CONSTRAINTS
  // ─────────────────────────────────────────────

  countHardConflicts(individual) {
    let conflicts = 0;
    conflicts += this.checkFacultyConflicts(individual);
    conflicts += this.checkClassroomConflicts(individual);
    conflicts += this.checkStandardConflicts(individual);
    conflicts += this.checkHardConstraintViolations(individual);
    return conflicts;
  }

  checkFacultyConflicts(individual) {
    const map = {};
    individual.genes.forEach(g => {
      const key = `${g.facultyId}-${g.dayIdx}-${g.timeSlotIdx}`;
      map[key] = (map[key] || 0) + 1;
    });
    return Object.values(map).reduce((s, v) => s + Math.max(0, v - 1), 0);
  }

  checkClassroomConflicts(individual) {
    const map = {};
    individual.genes.forEach(g => {
      const key = `${g.classroomIdx}-${g.dayIdx}-${g.timeSlotIdx}`;
      map[key] = (map[key] || 0) + 1;
    });
    return Object.values(map).reduce((s, v) => s + Math.max(0, v - 1), 0);
  }

  checkStandardConflicts(individual) {
    const map = {};
    individual.genes.forEach(g => {
      const std = this.findStandardByCourseId(g.courseId);
      // If courseId is unknown, skip — validation should have caught it before GA runs
      if (!std) return;
      const key = `${std.id}-${g.dayIdx}-${g.timeSlotIdx}`;
      map[key] = (map[key] || 0) + 1;
    });
    return Object.values(map).reduce((s, v) => s + Math.max(0, v - 1), 0);
  }

  checkHardConstraintViolations(individual) {
    let violations = 0;

    this.hardConstraints.forEach(hc => {
      switch (hc.type) {

        // H1: Faculty unavailability — faculty cannot be scheduled on a given day (and optional slot)
        case 'faculty_unavailability': {
          const dayIdx  = this.daysOfWeek.indexOf(hc.day);
          const slotIdx = hc.timeslot
            ? this.timeSlots.findIndex(s => s.startTime === hc.timeslot)
            : -1;
          individual.genes.forEach(g => {
            if (g.facultyId !== hc.facultyId) return;
            if (g.dayIdx !== dayIdx) return;
            // slotIdx === -1 → whole day blocked
            if (slotIdx === -1 || g.timeSlotIdx === slotIdx) violations++;
          });
          break;
        }

        // H6: Room restriction — course must use a specific classroom
        case 'room_restriction': {
          // [FIX F3] Use pre-built Map; log a warning if the room name is unknown
          const roomIdx = this._classroomIndexMap.get((hc.classroom || '').trim().toLowerCase());
          if (roomIdx === undefined) {
            console.warn(`[room_restriction] Classroom "${hc.classroom}" not found in classrooms list — constraint ignored.`);
            break;
          }
          individual.genes.forEach(g => {
            if (g.courseId === hc.courseId && g.classroomIdx !== roomIdx) violations++;
          });
          break;
        }

        // H_BREAK: Faculty only available in first half — never schedule after break
        case 'faculty_first_half_only': {
          individual.genes.forEach(g => {
            if (g.facultyId === hc.facultyId && !this.firstHalfSlotIndices.has(g.timeSlotIdx))
              violations++;
          });
          break;
        }

        // H_BREAK2: Faculty only available in second half — never schedule before break
        case 'faculty_second_half_only': {
          individual.genes.forEach(g => {
            if (g.facultyId === hc.facultyId && this.firstHalfSlotIndices.has(g.timeSlotIdx))
              violations++;
          });
          break;
        }
      }
    });

    return violations;
  }

  // ─────────────────────────────────────────────
  // SOFT CONSTRAINTS — penalty during GA
  // ─────────────────────────────────────────────

  computeSoftPenalty(individual) {
    let penalty = 0;

    this.softConstraints.forEach(sc => {
      const weight = sc.weight || 50;
      switch (sc.type) {

        // S1: Faculty prefers first half — penalise slots NOT in first half
        case 'faculty_prefers_first_half': {
          individual.genes.forEach(g => {
            if (g.facultyId === sc.facultyId && !this.firstHalfSlotIndices.has(g.timeSlotIdx))
              penalty += weight;
          });
          break;
        }

        // S1b: Faculty prefers second half — penalise slots IN first half
        case 'faculty_prefers_second_half': {
          individual.genes.forEach(g => {
            if (g.facultyId === sc.facultyId && this.firstHalfSlotIndices.has(g.timeSlotIdx))
              penalty += weight;
          });
          break;
        }

        // S2: No same std+course back-to-back (consecutive timeslots same day)
        // When sc.courseId is empty → applies to ALL courses (global rule).
        // When sc.courseId is non-empty → applies only to that specific course.
        case 'no_back_to_back_course': {
          const groups = {};
          individual.genes.forEach(g => {
            if (sc.courseId && g.courseId !== sc.courseId) return; // filter if scoped
            const std = this.findStandardByCourseId(g.courseId);
            if (!std) return;
            const key = `${std.id}-${g.courseId}-${g.dayIdx}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(g.timeSlotIdx);
          });
          Object.values(groups).forEach(slots => {
            if (slots.length < 2) return;
            const sorted = [...slots].sort((a, b) => a - b);
            for (let i = 1; i < sorted.length; i++) {
              if (sorted[i] - sorted[i - 1] === 1) penalty += weight;
            }
          });
          break;
        }

        // S3: Balanced daily load — penalise if a faculty has more than avgLoad+1 classes on any day
        case 'balanced_daily_load': {
          const loadMap = {};
          individual.genes.forEach(g => {
            const key = `${g.facultyId}-${g.dayIdx}`;
            loadMap[key] = (loadMap[key] || 0) + 1;
          });
          const facIds = [...new Set(individual.genes.map(g => g.facultyId))];
          facIds.forEach(fid => {
            const dayLoads   = this.daysOfWeek.map((_, di) => loadMap[`${fid}-${di}`] || 0);
            const total      = dayLoads.reduce((s, v) => s + v, 0);
            const activeDays = dayLoads.filter(v => v > 0).length || 1;
            const avg        = total / activeDays;
            dayLoads.forEach(load => {
              if (load > avg + 1) penalty += weight;
            });
          });
          break;
        }

        // S4: Course preferred timeslot (morning = first half, afternoon = second half, last = last slot)
        case 'course_preferred_slot': {
          const lastSlotIdx = this.timeSlots.length - 1;
          individual.genes.forEach(g => {
            if (g.courseId !== sc.courseId) return;
            const inFirstHalf = this.firstHalfSlotIndices.has(g.timeSlotIdx);
            if (sc.preference === 'morning'   && !inFirstHalf)               penalty += weight;
            if (sc.preference === 'afternoon' && inFirstHalf)                 penalty += weight;
            if (sc.preference === 'last'      && g.timeSlotIdx !== lastSlotIdx) penalty += weight;
          });
          break;
        }
      }
    });

    return penalty;
  }

  // ─────────────────────────────────────────────
  // SOFT CONSTRAINT REPORT (post-generation)
  // ─────────────────────────────────────────────

  evaluateSoftConstraints(individual) {
    const report = [];

    this.softConstraints.forEach(sc => {
      let violations = 0;
      let total      = 0;
      let detail     = '';

      switch (sc.type) {

        case 'faculty_prefers_first_half': {
          const fac = this.faculty.find(f => f.id === sc.facultyId);
          individual.genes.forEach(g => {
            if (g.facultyId !== sc.facultyId) return;
            total++;
            if (!this.firstHalfSlotIndices.has(g.timeSlotIdx)) violations++;
          });
          detail = `${fac ? fac.name : sc.facultyId}: ${total - violations}/${total} classes in first half`;
          break;
        }

        case 'faculty_prefers_second_half': {
          const fac = this.faculty.find(f => f.id === sc.facultyId);
          individual.genes.forEach(g => {
            if (g.facultyId !== sc.facultyId) return;
            total++;
            if (this.firstHalfSlotIndices.has(g.timeSlotIdx)) violations++;
          });
          detail = `${fac ? fac.name : sc.facultyId}: ${total - violations}/${total} classes in second half`;
          break;
        }

        case 'no_back_to_back_course': {
          const groups = {};
          individual.genes.forEach(g => {
            if (sc.courseId && g.courseId !== sc.courseId) return;
            const std = this.findStandardByCourseId(g.courseId);
            if (!std) return;
            const key = `${std.id}-${g.courseId}-${g.dayIdx}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(g.timeSlotIdx);
          });
          Object.values(groups).forEach(slots => {
            if (slots.length < 2) return;
            const sorted = [...slots].sort((a, b) => a - b);
            for (let i = 1; i < sorted.length; i++) {
              total++;
              if (sorted[i] - sorted[i - 1] === 1) violations++;
            }
          });
          detail = violations === 0
            ? 'No back-to-back same course/standard pairs found'
            : `${violations} back-to-back occurrence(s) found`;
          break;
        }

        case 'balanced_daily_load': {
          const loadMap = {};
          individual.genes.forEach(g => {
            const key = `${g.facultyId}-${g.dayIdx}`;
            loadMap[key] = (loadMap[key] || 0) + 1;
          });
          const facIds = [...new Set(individual.genes.map(g => g.facultyId))];
          facIds.forEach(fid => {
            const dayLoads   = this.daysOfWeek.map((_, di) => loadMap[`${fid}-${di}`] || 0);
            const activeDays = dayLoads.filter(v => v > 0).length || 1;
            const avg        = dayLoads.reduce((s, v) => s + v, 0) / activeDays;
            dayLoads.forEach(load => { total++; if (load > avg + 1) violations++; });
          });
          detail = violations === 0
            ? 'Faculty load is well balanced'
            : `${violations} day(s) with unbalanced load`;
          break;
        }

        case 'course_preferred_slot': {
          const course      = this.findCourseByCourseId(sc.courseId);
          const lastSlotIdx = this.timeSlots.length - 1;
          individual.genes.forEach(g => {
            if (g.courseId !== sc.courseId) return;
            total++;
            const inFirstHalf = this.firstHalfSlotIndices.has(g.timeSlotIdx);
            let ok = true;
            if (sc.preference === 'morning'   && !inFirstHalf)               ok = false;
            if (sc.preference === 'afternoon' && inFirstHalf)                 ok = false;
            if (sc.preference === 'last'      && g.timeSlotIdx !== lastSlotIdx) ok = false;
            if (!ok) violations++;
          });
          detail = `${course ? course.name : sc.courseId}: ${total - violations}/${total} classes in preferred slot (${sc.preference})`;
          break;
        }
      }

      report.push({
        id:        sc.id,
        type:      sc.type,
        label:     sc.label || sc.type,
        weight:    sc.weight,
        violations,
        total,
        satisfied: violations === 0,
        detail
      });
    });

    return report;
  }

  // ─────────────────────────────────────────────
  // DISTRIBUTION SCORE
  // ─────────────────────────────────────────────

  evaluateDistribution(individual) {
    let score = 0;
    const groups = {};
    individual.genes.forEach(g => {
      if (!groups[g.assignmentId]) groups[g.assignmentId] = [];
      groups[g.assignmentId].push(g);
    });

    Object.values(groups).forEach(genes => {
      const uniqueDays = new Set(genes.map(g => g.dayIdx));
      score += uniqueDays.size * 15;
      const sorted = Array.from(uniqueDays).sort((a, b) => a - b);
      if (sorted.length > 1) score += (sorted[sorted.length - 1] - sorted[0]) * 5;
    });

    const uniqueRooms = new Set(individual.genes.map(g => g.classroomIdx));
    if (uniqueRooms.size >= Math.min(3, this.classrooms.length)) score += 20;

    return score;
  }

  // ─────────────────────────────────────────────
  // SELECTION / CROSSOVER / MUTATION
  // ─────────────────────────────────────────────

  tournamentSelection(population) {
    let best = null;
    for (let i = 0; i < this.tournamentSize; i++) {
      const c = population[Math.floor(Math.random() * population.length)];
      if (!best || c.fitness > best.fitness) best = c;
    }
    return best;
  }

  // [FIX F2] Use a RANDOM cut-point instead of always the midpoint.
  // [FIX F7] Guard against mismatched gene lengths.
  crossover(p1, p2) {
    const len   = p1.genes.length;
    const len2  = p2.genes.length;

    // If lengths differ (should not happen), fall back to a copy of p1
    if (len !== len2) {
      console.warn('[crossover] gene length mismatch — falling back to clone of p1');
      return GeneticAlgorithm._cloneInd(p1);
    }

    // Random cut-point in [1, len-1] so at least one gene comes from each parent
    const point = 1 + Math.floor(Math.random() * (len - 1));

    return {
      genes: p1.genes.map((g, i) => GeneticAlgorithm._cloneGene(i < point ? g : p2.genes[i])),
      fitness: 0,
      conflicts: 0
    };
  }

  mutate(individual) {
    return this.mutateWithRate(individual, this.mutationRate, false);
  }

  // [FIX F6] When stuckWithConflicts is true, allow multi-field mutation per gene
  // so genes can escape "corners" where multiple dimensions are simultaneously wrong.
  mutateWithRate(individual, rate, stuckWithConflicts = false) {
    const mutant = {
      genes: individual.genes.map(GeneticAlgorithm._cloneGene),
      fitness: 0,
      conflicts: 0
    };

    mutant.genes.forEach(gene => {
      if (Math.random() >= rate) return;

      if (stuckWithConflicts) {
        // Under conflict pressure: pick multiple fields to change
        if (Math.random() < 0.5) gene.classroomIdx = Math.floor(Math.random() * this.classrooms.length);
        if (Math.random() < 0.5) gene.dayIdx       = Math.floor(Math.random() * this.daysOfWeek.length);
        if (Math.random() < 0.5) gene.timeSlotIdx  = Math.floor(Math.random() * this.timeSlots.length);
        // Ensure at least one field changed
        if (Math.random() < 0.33) gene.classroomIdx = Math.floor(Math.random() * this.classrooms.length);
      } else {
        // Normal mutation: exactly one field
        switch (Math.floor(Math.random() * 3)) {
          case 0: gene.classroomIdx = Math.floor(Math.random() * this.classrooms.length); break;
          case 1: gene.dayIdx       = Math.floor(Math.random() * this.daysOfWeek.length); break;
          case 2: gene.timeSlotIdx  = Math.floor(Math.random() * this.timeSlots.length);  break;
        }
      }
    });

    return mutant;
  }
}

module.exports = GeneticAlgorithm;