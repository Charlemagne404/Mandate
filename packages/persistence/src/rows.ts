import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { WorldState } from '@mandate/schemas';
import type { WorldState as World } from '@mandate/schemas';

export function readWorld(db: DatabaseSync): World | null {
  const meta = db.prepare('SELECT * FROM world_meta WHERE singleton = 1').get();
  if (!meta) return null;
  const rows = (sql: string, ...args: SQLInputValue[]) =>
    db.prepare(sql).all(...args);
  const ids = (sql: string, id: SQLInputValue) =>
    rows(sql, id).map((r) => r.nation_id);
  const json = (value: unknown): unknown => JSON.parse(String(value));
  const world = {
    ...Object.fromEntries(
      [
        'knowledge',
        'crises',
        'economicLinks',
        'sanctions',
        'conferences',
        'tenures',
      ].map((collection) => [
        collection,
        rows(
          'SELECT state_json FROM continuity_entities WHERE collection = ? ORDER BY id',
          collection,
        ).map((r) => json(r.state_json)),
      ]),
    ),
    observerMode: rows(
      "SELECT state_json FROM continuity_entities WHERE collection = 'world' AND id = 'observer'",
    ).some((r) => json(r.state_json) === true),
    schemaVersion: meta.schema_version,
    saveId: meta.save_id,
    ancestry: json(meta.ancestry_json),
    scenario: json(meta.scenario_json),
    date: meta.simulation_date,
    revision: meta.revision,
    playerNationId: meta.player_nation_id,
    nations: rows('SELECT * FROM nations ORDER BY id').map((n) => ({
      id: n.id,
      name: n.name,
      color: n.color,
      government: { type: n.government_type, ideology: n.ideology },
      leader: n.leader,
      strategy: json(n.strategy_json),
      stats: {
        economy: n.economy,
        military: n.military,
        stability: n.stability,
        legitimacy: n.legitimacy,
        treasury: n.treasury,
        ...(json(n.dimensions_json) as object),
      },
    })),
    regions: rows('SELECT * FROM regions ORDER BY id').map((r) => ({
      id: r.id,
      name: r.name,
      geometryId: r.geometry_id,
      ownerNationId: r.owner_nation_id,
      controllerNationId: r.controller_nation_id,
      claims: ids(
        'SELECT nation_id FROM claims WHERE region_id = ? ORDER BY nation_id',
        r.id!,
      ),
      recognizedClaims: json(r.recognized_claims_json),
    })),
    relations: rows('SELECT * FROM relations ORDER BY nation_a,nation_b').map(
      (r) => ({
        nationA: r.nation_a,
        nationB: r.nation_b,
        score: r.score,
        ...(json(r.dimensions_json) as object),
      }),
    ),
    treaties: rows('SELECT * FROM treaties ORDER BY id').map((r) => {
      const state = json(r.state_json) as Record<string, unknown>;
      if (Object.keys(state).length) return state;
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        status: r.status,
        terms: r.terms,
        visibility: r.visibility,
        conflictId: r.conflict_id,
        parties: ids(
          'SELECT nation_id FROM treaty_parties WHERE treaty_id = ? ORDER BY nation_id',
          r.id!,
        ),
      };
    }),
    conflicts: rows('SELECT * FROM conflicts ORDER BY id').map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      escalation: r.escalation,
      ...(json(r.strategy_json) as object),
      attackers: ids(
        "SELECT nation_id FROM conflict_participants WHERE conflict_id = ? AND side = 'attacker' ORDER BY nation_id",
        r.id!,
      ),
      defenders: ids(
        "SELECT nation_id FROM conflict_participants WHERE conflict_id = ? AND side = 'defender' ORDER BY nation_id",
        r.id!,
      ),
    })),
    goals: rows('SELECT * FROM goals ORDER BY id').map((r) => ({
      id: r.id,
      nationId: r.nation_id,
      title: r.title,
      priority: r.priority,
      status: r.status,
      progress: r.progress,
      reason: r.reason,
      createdDate: r.created_date,
      updatedDate: r.updated_date,
      ...(json(r.metadata_json) as object),
      targetNationIds: ids(
        'SELECT nation_id FROM goal_targets WHERE goal_id = ? ORDER BY nation_id',
        r.id!,
      ),
    })),
    commitments: rows('SELECT state_json FROM commitments ORDER BY id').map(
      (r) => json(r.state_json),
    ),
    initiatives: rows('SELECT state_json FROM initiatives ORDER BY id').map(
      (r) => json(r.state_json),
    ),
    negotiations: rows('SELECT state_json FROM negotiations ORDER BY id').map(
      (r) => json(r.state_json),
    ),
    organizations: rows('SELECT state_json FROM organizations ORDER BY id').map(
      (r) => json(r.state_json),
    ),
    turns: rows('SELECT * FROM turns ORDER BY revision').map((r) => ({
      id: r.id,
      revision: r.revision,
      previousDate: r.previous_date,
      date: r.simulation_date,
      recordedAt: r.recorded_at,
      actionId: r.action_id,
      commandIds: rows(
        'SELECT id FROM commands WHERE turn_id = ? ORDER BY ordinal',
        r.id!,
      ).map((v) => v.id),
      eventIds: rows(
        'SELECT id FROM events WHERE turn_id = ? ORDER BY ordinal',
        r.id!,
      ).map((v) => v.id),
      ...(r.event_metrics_json == null
        ? {}
        : { eventMetrics: json(r.event_metrics_json) }),
      ...(r.suppressed_command_ids_json == null
        ? {}
        : { suppressedCommandIds: json(r.suppressed_command_ids_json) }),
    })),
    actions: rows('SELECT * FROM actions ORDER BY id').map((r) => ({
      id: r.id,
      turnId: r.turn_id,
      actorNationId: r.actor_nation_id,
      source: r.source,
      text: r.text,
      ...(r.semantic_graph_json == null
        ? {}
        : { semanticGraph: json(r.semantic_graph_json) }),
      ...(r.grounding_json == null
        ? {}
        : { grounding: json(r.grounding_json) }),
    })),
    commands: rows('SELECT * FROM commands ORDER BY turn_id,ordinal').map(
      (r) => ({
        id: r.id,
        turnId: r.turn_id,
        actionId: r.action_id,
        simulationDate: r.simulation_date,
        recordedAt: r.recorded_at,
        reason: r.reason,
        validation: r.validation,
        command: json(r.command_json),
      }),
    ),
    events: rows(
      'SELECT e.* FROM events e JOIN turns t ON t.id = e.turn_id ORDER BY t.revision,e.ordinal',
    ).map((r) => ({
      id: r.id,
      turnId: r.turn_id,
      date: r.simulation_date,
      type: r.type,
      title: r.title,
      nationIds: json(r.nation_ids_json),
      regionIds: json(r.region_ids_json),
      treatyIds: json(r.treaty_ids_json),
      conflictIds: json(r.conflict_ids_json),
      importance: r.importance,
      effects: json(r.effects_json),
      topics: json(r.topics_json),
      visibility: r.visibility,
      status: r.status,
      ...(r.novelty == null ? {} : { novelty: r.novelty }),
      ...(r.semantic_signature == null
        ? {}
        : { semanticSignature: r.semantic_signature }),
      ...(r.provenance_json == null
        ? {}
        : { provenance: json(r.provenance_json) }),
      sourceCommandIds: rows(
        'SELECT command_id FROM event_sources WHERE event_id = ? ORDER BY command_id',
        r.id!,
      ).map((v) => v.command_id),
    })),
  };
  return WorldState.parse(world);
}

// Mutable entity rows are rebuilt within a deferred-FK transaction; audit rows are only appended.
export function writeEntities(db: DatabaseSync, w: World): void {
  for (const table of [
    'continuity_entities',
    'world_meta',
    'commitments',
    'organization_members',
    'organizations',
    'negotiations',
    'initiatives',
    'claims',
    'regions',
    'relations',
    'treaty_parties',
    'treaties',
    'conflict_participants',
    'conflicts',
    'goal_targets',
    'goals',
    'nations',
  ])
    db.exec(`DELETE FROM ${table}`);
  const insert = (sql: string, ...values: SQLInputValue[]) =>
    db.prepare(sql).run(...values);
  insert(
    'INSERT INTO continuity_entities VALUES (?,?,?)',
    'world',
    'observer',
    JSON.stringify(w.observerMode),
  );
  for (const collection of [
    'knowledge',
    'crises',
    'economicLinks',
    'sanctions',
    'conferences',
    'tenures',
  ] as const)
    for (const entity of w[collection])
      insert(
        'INSERT INTO continuity_entities VALUES (?,?,?)',
        collection,
        entity.id,
        JSON.stringify(entity),
      );
  for (const n of w.nations)
    insert(
      'INSERT INTO nations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      n.id,
      n.name,
      n.color,
      n.government.type,
      n.government.ideology,
      n.leader,
      n.stats.economy,
      n.stats.military,
      n.stats.stability,
      n.stats.legitimacy,
      n.stats.treasury,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(n.stats).filter(
            ([key]) =>
              ![
                'economy',
                'military',
                'stability',
                'legitimacy',
                'treasury',
              ].includes(key),
          ),
        ),
      ),
      JSON.stringify(n.strategy),
    );
  for (const r of w.regions) {
    insert(
      'INSERT INTO regions (id,name,geometry_id,owner_nation_id,controller_nation_id,recognized_claims_json) VALUES (?,?,?,?,?,?)',
      r.id,
      r.name,
      r.geometryId,
      r.ownerNationId,
      r.controllerNationId,
      JSON.stringify(r.recognizedClaims),
    );
    for (const id of r.claims)
      insert('INSERT INTO claims VALUES (?,?)', r.id, id);
  }
  for (const r of w.relations)
    insert(
      'INSERT INTO relations VALUES (?,?,?,?)',
      r.nationA,
      r.nationB,
      r.score,
      JSON.stringify({
        trust: r.trust,
        tension: r.tension,
        tradeDependence: r.tradeDependence,
        militaryAlignment: r.militaryAlignment,
        grievances: r.grievances,
        factors: r.factors,
      }),
    );
  for (const t of w.treaties) {
    insert(
      'INSERT INTO treaties VALUES (?,?,?,?,?,?,?,?)',
      t.id,
      t.name,
      t.kind,
      t.status,
      t.terms,
      t.visibility,
      t.conflictId,
      JSON.stringify(t),
    );
    for (const id of t.parties)
      insert('INSERT INTO treaty_parties VALUES (?,?)', t.id, id);
  }
  for (const c of w.conflicts) {
    insert(
      'INSERT INTO conflicts VALUES (?,?,?,?,?)',
      c.id,
      c.name,
      c.status,
      c.escalation,
      JSON.stringify({
        exhaustion: c.exhaustion,
        logistics: c.logistics,
        warGoals: c.warGoals,
        campaigns: c.campaigns,
        theaters: c.theaters,
        settlementState: c.settlementState,
      }),
    );
    for (const id of c.attackers)
      insert(
        'INSERT INTO conflict_participants VALUES (?,?,?)',
        c.id,
        id,
        'attacker',
      );
    for (const id of c.defenders)
      insert(
        'INSERT INTO conflict_participants VALUES (?,?,?)',
        c.id,
        id,
        'defender',
      );
  }
  for (const g of w.goals) {
    insert(
      'INSERT INTO goals VALUES (?,?,?,?,?,?,?,?,?,?)',
      g.id,
      g.nationId,
      g.title,
      g.priority,
      g.status,
      g.progress,
      g.reason,
      g.createdDate,
      g.updatedDate,
      JSON.stringify({
        kind: g.kind,
        visibility: g.visibility,
        deadline: g.deadline,
        blockers: g.blockers,
        evidence: g.evidence,
        signals: g.signals,
        parentGoalId: g.parentGoalId,
        evaluation: g.evaluation,
        pressure: g.pressure,
        stalledDays: g.stalledDays,
        deferredToGoalId: g.deferredToGoalId,
        strategyReview: g.strategyReview,
      }),
    );
    for (const id of g.targetNationIds)
      insert('INSERT INTO goal_targets VALUES (?,?)', g.id, id);
  }
  for (const i of w.initiatives)
    insert(
      'INSERT INTO initiatives VALUES (?,?,?,?)',
      i.id,
      i.nationId,
      i.targetNationId,
      JSON.stringify(i),
    );
  for (const n of w.negotiations)
    insert(
      'INSERT INTO negotiations VALUES (?,?,?,?,?,?)',
      n.id,
      n.proposerNationId,
      n.recipientNationId,
      n.treatyId,
      JSON.stringify(n),
      n.conflictId,
    );
  for (const c of w.commitments)
    insert(
      'INSERT INTO commitments VALUES (?,?,?,?)',
      c.id,
      c.issuer,
      c.sourceNegotiationId,
      JSON.stringify(c),
    );
  for (const o of w.organizations) {
    insert('INSERT INTO organizations VALUES (?,?)', o.id, JSON.stringify(o));
    for (const id of o.members)
      insert('INSERT INTO organization_members VALUES (?,?)', o.id, id);
  }
  insert(
    'INSERT INTO world_meta VALUES (1,?,?,?,?,?,?,?)',
    w.schemaVersion,
    w.saveId,
    JSON.stringify(w.ancestry),
    JSON.stringify(w.scenario),
    w.date,
    w.revision,
    w.playerNationId,
  );
}
export function appendHistory(
  db: DatabaseSync,
  w: World,
  afterRevision: number,
): void {
  const insert = (sql: string, ...values: SQLInputValue[]) =>
    db.prepare(sql).run(...values);
  for (const t of w.turns.filter((t) => t.revision > afterRevision)) {
    const a = w.actions.find((a) => a.id === t.actionId)!;
    insert(
      'INSERT INTO turns (id,revision,previous_date,simulation_date,recorded_at,action_id,event_metrics_json,suppressed_command_ids_json) VALUES (?,?,?,?,?,?,?,?)',
      t.id,
      t.revision,
      t.previousDate,
      t.date,
      t.recordedAt,
      t.actionId,
      t.eventMetrics ? JSON.stringify(t.eventMetrics) : null,
      t.suppressedCommandIds ? JSON.stringify(t.suppressedCommandIds) : null,
    );
    insert(
      'INSERT INTO actions VALUES (?,?,?,?,?,?,?)',
      a.id,
      a.turnId,
      a.actorNationId,
      a.source,
      a.text,
      a.grounding ? JSON.stringify(a.grounding) : null,
      a.semanticGraph ? JSON.stringify(a.semanticGraph) : null,
    );
    t.commandIds.forEach((id, ordinal) => {
      const c = w.commands.find((c) => c.id === id)!;
      insert(
        'INSERT INTO commands VALUES (?,?,?,?,?,?,?,?,?,?)',
        c.id,
        c.turnId,
        c.actionId,
        ordinal,
        c.simulationDate,
        c.recordedAt,
        c.reason,
        c.validation,
        c.command.type,
        JSON.stringify(c.command),
      );
    });
    t.eventIds.forEach((id, ordinal) => {
      const e = w.events.find((e) => e.id === id)!;
      insert(
        'INSERT INTO events (id,turn_id,ordinal,simulation_date,type,title,nation_ids_json,region_ids_json,treaty_ids_json,conflict_ids_json,importance,topics_json,visibility,status,effects_json,novelty,semantic_signature,provenance_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        e.id,
        e.turnId,
        ordinal,
        e.date,
        e.type,
        e.title,
        JSON.stringify(e.nationIds),
        JSON.stringify(e.regionIds),
        JSON.stringify(e.treatyIds),
        JSON.stringify(e.conflictIds),
        e.importance,
        JSON.stringify(e.topics),
        e.visibility,
        e.status,
        JSON.stringify(e.effects),
        e.novelty ?? null,
        e.semanticSignature ?? null,
        e.provenance ? JSON.stringify(e.provenance) : null,
      );
      for (const commandId of e.sourceCommandIds)
        insert('INSERT INTO event_sources VALUES (?,?)', e.id, commandId);
    });
  }
}
