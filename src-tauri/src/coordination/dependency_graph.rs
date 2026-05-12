use std::collections::HashSet;

use rusqlite::params;
use serde_json::{json, Value};
use uuid::Uuid;

use super::{
    db::REPO_ID,
    kernel::{api_ok, now_rfc3339, CoordinationKernel, EventRefs},
    resources::{lease_mode_conflict_reason, normalize_resource_key, resource_conflict_reason},
};

const TERMINAL_TASK_STATUSES: &[&str] = &["done", "completed", "merged", "cancelled", "skipped"];
const TERMINAL_PATCH_STATUSES: &[&str] = &[
    "merged",
    "validation_failed",
    "merge_failed",
    "failed",
    "rejected",
    "cancelled",
];

#[derive(Debug, Clone)]
pub(crate) struct DependencyEdgeInput {
    pub dependent_task_id: String,
    pub prerequisite_kind: String,
    pub prerequisite_key: String,
    pub predicate_kind: String,
    pub predicate_json: Value,
    pub required: bool,
    pub status: Option<String>,
    pub created_by_type: String,
    pub created_by_id: String,
    pub evidence_event_id: Option<String>,
}

#[derive(Debug, Clone)]
struct EdgeEvaluation {
    status: String,
    reason: String,
    proof_artifact_id: Option<String>,
}

impl CoordinationKernel {
    pub fn create_dependency(&self, input: &Value) -> Result<Value, String> {
        let dependent_task_id = required_string(input, "task_id")
            .or_else(|_| required_string(input, "dependent_task_id"))?;
        let prerequisite_kind = required_string(input, "prerequisite_kind")?;
        let prerequisite_key = required_string(input, "prerequisite_key")?;
        let predicate_kind = required_string(input, "predicate_kind")?;
        let predicate_json = input
            .get("predicate_json")
            .cloned()
            .or_else(|| input.get("predicate").cloned())
            .unwrap_or_else(|| json!({}));
        let edge = self.create_dependency_edge(DependencyEdgeInput {
            dependent_task_id: dependent_task_id.to_string(),
            prerequisite_kind: prerequisite_kind.to_string(),
            prerequisite_key: prerequisite_key.to_string(),
            predicate_kind: predicate_kind.to_string(),
            predicate_json,
            required: input["required"].as_bool().unwrap_or(true),
            status: input["status"].as_str().map(str::to_string),
            created_by_type: input["created_by_type"]
                .as_str()
                .or_else(|| input["actor_type"].as_str())
                .unwrap_or("agent")
                .to_string(),
            created_by_id: input["created_by_id"]
                .as_str()
                .or_else(|| input["actor_id"].as_str())
                .or_else(|| input["agent_id"].as_str())
                .unwrap_or("local")
                .to_string(),
            evidence_event_id: input["evidence_event_id"].as_str().map(str::to_string),
        })?;
        let evaluation = self.reevaluate_dependencies(Some(dependent_task_id))?;
        Ok(api_ok(json!({
            "dependency": edge,
            "evaluation": evaluation["data"].clone(),
        })))
    }

    pub(crate) fn create_dependency_edge(
        &self,
        input: DependencyEdgeInput,
    ) -> Result<Value, String> {
        self.ensure_dependency_task_exists(&input.dependent_task_id)?;
        let prerequisite_kind = normalize_dependency_kind(&input.prerequisite_kind)?;
        let prerequisite_key =
            normalize_prerequisite_key(&prerequisite_kind, &input.prerequisite_key);
        let predicate_kind = normalize_predicate_kind(&input.predicate_kind)?;
        validate_predicate_kind(&predicate_kind)?;
        let predicate_json = normalize_predicate_json(input.predicate_json);
        let predicate_text = predicate_json.to_string();
        let composition = "all_of";
        let mut status = input
            .status
            .as_deref()
            .map(normalize_dependency_status)
            .transpose()?
            .unwrap_or_else(|| "pending".to_string());

        if status == "pending" {
            if let Some(prerequisite_task_id) = dependency_prerequisite_task_id(
                &prerequisite_kind,
                &prerequisite_key,
                &predicate_json,
            ) {
                self.ensure_dependency_task_exists(&prerequisite_task_id)?;
                if self
                    .dependency_edge_would_cycle(&input.dependent_task_id, &prerequisite_task_id)?
                {
                    status = "cycle_prevented".to_string();
                }
            }
        }

        let existing = self.query_json(
            "SELECT * FROM dependency_edges
             WHERE dependent_task_id=?1
               AND prerequisite_kind=?2
               AND prerequisite_key=?3
               AND predicate_kind=?4
               AND predicate_json=?5
             LIMIT 1",
            &[
                &input.dependent_task_id,
                &prerequisite_kind,
                &prerequisite_key,
                &predicate_kind,
                &predicate_text,
            ],
        )?;
        if let Some(edge) = existing.into_iter().next() {
            return Ok(json!({
                "edge": edge,
                "reused": true,
                "status": edge["status"].clone(),
            }));
        }

        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        self.conn
            .execute(
                "INSERT INTO dependency_edges(
                    id, dependent_task_id, prerequisite_kind, prerequisite_key,
                    predicate_kind, predicate_json, status, required, composition,
                    created_by_type, created_by_id, evidence_event_id, created_at, updated_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
                params![
                    id,
                    input.dependent_task_id,
                    prerequisite_kind,
                    prerequisite_key,
                    predicate_kind,
                    predicate_text,
                    status,
                    if input.required { 1 } else { 0 },
                    composition,
                    input.created_by_type,
                    input.created_by_id,
                    input.evidence_event_id,
                    now
                ],
            )
            .map_err(|error| format!("Unable to create dependency edge: {error}"))?;

        let edge = self.dependency_edge_by_id(&id)?;
        self.emit_event(
            if status == "cycle_prevented" {
                "dependency_cycle_prevented"
            } else {
                "dependency_created"
            },
            edge["created_by_type"].as_str().unwrap_or("kernel"),
            edge["created_by_id"].as_str().unwrap_or(REPO_ID),
            EventRefs {
                task_id: Some(
                    edge["dependent_task_id"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                ),
                ..EventRefs::default()
            },
            json!({
                "dependency_edge_id": id,
                "dependent_task_id": edge["dependent_task_id"].clone(),
                "prerequisite_kind": edge["prerequisite_kind"].clone(),
                "prerequisite_key": edge["prerequisite_key"].clone(),
                "predicate_kind": edge["predicate_kind"].clone(),
                "status": edge["status"].clone(),
                "required": edge["required"].clone(),
            }),
        )?;
        self.refresh_dependency_graph_blocked_status(
            edge["dependent_task_id"].as_str().unwrap_or_default(),
            "kernel",
            REPO_ID,
        )?;

        Ok(json!({
            "edge": edge,
            "reused": false,
            "status": status,
        }))
    }

    pub fn list_dependencies(
        &self,
        task_id: Option<&str>,
        status: Option<&str>,
        include_satisfied: bool,
    ) -> Result<Value, String> {
        let mut sql = "SELECT * FROM dependency_edges WHERE 1=1".to_string();
        let mut values = Vec::<String>::new();
        if let Some(task_id) = task_id.filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND dependent_task_id=?");
            values.push(task_id.trim().to_string());
        }
        if let Some(status) = status.filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND status=?");
            values.push(status.trim().to_ascii_lowercase());
        } else if !include_satisfied {
            sql.push_str(" AND status <> 'satisfied'");
        }
        sql.push_str(" ORDER BY updated_at DESC LIMIT 500");
        let params = values
            .iter()
            .map(|value| value as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        let dependencies = self.query_json(&sql, &params)?;
        let blocking_dependencies = if let Some(task_id) = task_id {
            self.blocking_dependency_edges(task_id)?
        } else {
            Vec::new()
        };
        Ok(api_ok(json!({
            "dependencies": dependencies,
            "blocking_dependencies": blocking_dependencies,
        })))
    }

    pub fn explain_blockers(&self, task_id: &str) -> Result<Value, String> {
        self.reevaluate_dependencies(Some(task_id))?;
        let blockers = self.blocking_dependency_edges(task_id)?;
        let explanations = blockers
            .iter()
            .map(|edge| dependency_explanation(edge))
            .collect::<Vec<_>>();
        Ok(api_ok(json!({
            "task_id": task_id,
            "blocked": !blockers.is_empty(),
            "blocking_count": blockers.len(),
            "blockers": blockers,
            "explanations": explanations,
        })))
    }

    pub fn reevaluate_dependencies(&self, task_id: Option<&str>) -> Result<Value, String> {
        let mut sql = "SELECT * FROM dependency_edges WHERE required=1".to_string();
        let mut values = Vec::<String>::new();
        if let Some(task_id) = task_id.filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND dependent_task_id=?");
            values.push(task_id.trim().to_string());
        }
        sql.push_str(" ORDER BY created_at ASC LIMIT 1000");
        let params = values
            .iter()
            .map(|value| value as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        let edges = self.query_json(&sql, &params)?;
        self.reevaluate_dependency_edge_rows(edges, None)
    }

    pub fn cancel_dependency(
        &self,
        dependency_edge_id: &str,
        reason: Option<&str>,
        actor_type: Option<&str>,
        actor_id: Option<&str>,
    ) -> Result<Value, String> {
        let edge = self.dependency_edge_by_id(dependency_edge_id)?;
        let old_status = edge["status"].as_str().unwrap_or_default().to_string();
        let now = now_rfc3339();
        self.conn
            .execute(
                "UPDATE dependency_edges
                 SET status='cancelled', cancel_reason=?1, updated_at=?2
                 WHERE id=?3",
                params![reason, now, dependency_edge_id],
            )
            .map_err(|error| format!("Unable to cancel dependency edge: {error}"))?;
        let updated = self.dependency_edge_by_id(dependency_edge_id)?;
        self.emit_event(
            "dependency_cancelled",
            actor_type.unwrap_or("agent"),
            actor_id.unwrap_or("local"),
            EventRefs {
                task_id: updated["dependent_task_id"].as_str().map(str::to_string),
                ..EventRefs::default()
            },
            json!({
                "dependency_edge_id": dependency_edge_id,
                "old_status": old_status,
                "new_status": "cancelled",
                "reason": reason,
            }),
        )?;
        self.refresh_dependency_graph_blocked_status(
            updated["dependent_task_id"].as_str().unwrap_or_default(),
            "kernel",
            REPO_ID,
        )?;
        Ok(api_ok(json!({"dependency": updated})))
    }

    pub fn list_ready_tasks(&self, limit: Option<i64>) -> Result<Value, String> {
        let limit = limit.unwrap_or(100).clamp(1, 500);
        let tasks = self.query_json(
            "SELECT t.*
             FROM tasks t
             WHERE t.status='ready'
               AND NOT EXISTS (
                 SELECT 1
                 FROM dependency_edges d
                 WHERE d.dependent_task_id=t.id
                   AND d.required=1
                   AND d.status IN ('pending', 'invalidated', 'expired', 'cycle_prevented')
               )
             ORDER BY t.priority DESC, t.updated_at ASC
             LIMIT ?1",
            &[&limit],
        )?;
        Ok(api_ok(json!({"tasks": tasks})))
    }

    pub(crate) fn blocking_dependency_edges(&self, task_id: &str) -> Result<Vec<Value>, String> {
        self.query_json(
            "SELECT *
             FROM dependency_edges
             WHERE dependent_task_id=?1
               AND required=1
               AND status IN ('pending', 'invalidated', 'expired', 'cycle_prevented')
             ORDER BY created_at ASC",
            &[&task_id],
        )
    }

    pub(crate) fn refresh_dependency_graph_blocked_status(
        &self,
        task_id: &str,
        actor_type: &str,
        actor_id: &str,
    ) -> Result<(), String> {
        if task_id.trim().is_empty() {
            return Ok(());
        }
        let blockers = self.blocking_dependency_edges(task_id)?;
        let now = now_rfc3339();
        if blockers.is_empty() {
            let changed = self
                .conn
                .execute(
                    "UPDATE tasks
                     SET status='ready', updated_at=?1
                     WHERE id=?2
                       AND status='blocked'",
                    params![now, task_id],
                )
                .map_err(|error| format!("Unable to mark dependency graph task ready: {error}"))?;
            if changed > 0 {
                self.emit_event(
                    "task_dependencies_satisfied",
                    actor_type,
                    actor_id,
                    EventRefs {
                        task_id: Some(task_id.to_string()),
                        ..EventRefs::default()
                    },
                    json!({
                        "dependency_graph": true,
                        "blocking_count": 0,
                    }),
                )?;
            }
        } else {
            let changed = self
                .conn
                .execute(
                    "UPDATE tasks
                     SET status='blocked', updated_at=?1
                     WHERE id=?2
                       AND status NOT IN ('done', 'completed', 'merged', 'cancelled', 'interrupted', 'skipped')",
                    params![now, task_id],
                )
                .map_err(|error| format!("Unable to mark dependency graph task blocked: {error}"))?;
            if changed > 0 {
                self.emit_event(
                    "task_blocked_by_dependencies",
                    actor_type,
                    actor_id,
                    EventRefs {
                        task_id: Some(task_id.to_string()),
                        ..EventRefs::default()
                    },
                    json!({
                        "dependency_graph": true,
                        "blocking_count": blockers.len(),
                        "blocking_dependencies": blockers,
                    }),
                )?;
            }
        }
        Ok(())
    }

    pub(crate) fn reevaluate_dependency_edges_for_prerequisite_task(
        &self,
        prerequisite_task_id: &str,
        proof_event_id: Option<&str>,
    ) -> Result<Value, String> {
        let task_key = format!("task:{prerequisite_task_id}");
        let edges = self.query_json(
            "SELECT *
             FROM dependency_edges
             WHERE required=1
               AND (
                    (prerequisite_kind='task' AND prerequisite_key IN (?1, ?2))
                    OR json_extract(predicate_json, '$.blocked_by_task_id')=?2
               )
             ORDER BY created_at ASC",
            &[&task_key, &prerequisite_task_id],
        )?;
        self.reevaluate_dependency_edge_rows(edges, proof_event_id)
    }

    pub(crate) fn reevaluate_dependency_edges_for_patch(
        &self,
        patch_id: &str,
        proof_event_id: Option<&str>,
    ) -> Result<Value, String> {
        let patch_key = format!("patch:{patch_id}");
        let edges = self.query_json(
            "SELECT *
             FROM dependency_edges
             WHERE required=1
               AND prerequisite_kind='patch'
               AND prerequisite_key IN (?1, ?2)
             ORDER BY created_at ASC",
            &[&patch_key, &patch_id],
        )?;
        self.reevaluate_dependency_edge_rows(edges, proof_event_id)
    }

    pub(crate) fn reevaluate_dependency_edges_for_lease(
        &self,
        lease_id: &str,
        proof_event_id: Option<&str>,
    ) -> Result<Value, String> {
        let edges = self.query_json(
            "SELECT *
             FROM dependency_edges
             WHERE required=1
               AND (
                    json_extract(predicate_json, '$.lease_id')=?1
                    OR json_extract(predicate_json, '$.blocked_by_lease_id')=?1
               )
             ORDER BY created_at ASC",
            &[&lease_id],
        )?;
        self.reevaluate_dependency_edge_rows(edges, proof_event_id)
    }

    fn reevaluate_dependency_edge_rows(
        &self,
        edges: Vec<Value>,
        proof_event_id: Option<&str>,
    ) -> Result<Value, String> {
        let mut changed = Vec::new();
        let mut unchanged = Vec::new();
        let mut affected_tasks = HashSet::new();
        for edge in edges {
            let edge_id = edge["id"].as_str().unwrap_or_default();
            let old_status = edge["status"].as_str().unwrap_or_default();
            if matches!(old_status, "cancelled" | "cycle_prevented") {
                unchanged.push(json!({"dependency_edge_id": edge_id, "status": old_status}));
                continue;
            }
            let evaluation = self.evaluate_dependency_edge(&edge)?;
            if evaluation.status == old_status {
                unchanged.push(json!({
                    "dependency_edge_id": edge_id,
                    "status": old_status,
                    "reason": evaluation.reason,
                }));
                continue;
            }
            let updated = self.transition_dependency_edge(
                &edge,
                &evaluation.status,
                &evaluation.reason,
                proof_event_id,
                evaluation.proof_artifact_id.as_deref(),
            )?;
            if let Some(task_id) = updated["dependent_task_id"].as_str() {
                affected_tasks.insert(task_id.to_string());
            }
            changed.push(json!({
                "dependency_edge_id": edge_id,
                "old_status": old_status,
                "new_status": evaluation.status,
                "reason": evaluation.reason,
            }));
        }
        for task_id in &affected_tasks {
            self.refresh_dependency_graph_blocked_status(task_id, "kernel", REPO_ID)?;
        }
        Ok(api_ok(json!({
            "changed": changed,
            "unchanged": unchanged,
            "affected_task_ids": affected_tasks.into_iter().collect::<Vec<_>>(),
        })))
    }

    fn transition_dependency_edge(
        &self,
        edge: &Value,
        new_status: &str,
        reason: &str,
        proof_event_id: Option<&str>,
        proof_artifact_id: Option<&str>,
    ) -> Result<Value, String> {
        let edge_id = edge["id"].as_str().unwrap_or_default();
        let old_status = edge["status"].as_str().unwrap_or_default();
        let now = now_rfc3339();
        let (satisfied_event, invalidated_event) = match new_status {
            "satisfied" => (proof_event_id, None),
            "invalidated" | "expired" => (None, proof_event_id),
            _ => (None, None),
        };
        self.conn
            .execute(
                "UPDATE dependency_edges
                 SET status=?1,
                     satisfied_by_event_id=COALESCE(?2, satisfied_by_event_id),
                     satisfied_by_artifact_id=COALESCE(?3, satisfied_by_artifact_id),
                     invalidated_by_event_id=COALESCE(?4, invalidated_by_event_id),
                     updated_at=?5
                 WHERE id=?6",
                params![
                    new_status,
                    satisfied_event,
                    proof_artifact_id,
                    invalidated_event,
                    now,
                    edge_id
                ],
            )
            .map_err(|error| format!("Unable to transition dependency edge: {error}"))?;
        let updated = self.dependency_edge_by_id(edge_id)?;
        let event_type = match new_status {
            "satisfied" => "dependency_satisfied",
            "invalidated" => "dependency_invalidated",
            "expired" => "dependency_expired",
            "cycle_prevented" => "dependency_cycle_prevented",
            _ => "dependency_updated",
        };
        self.emit_event(
            event_type,
            "kernel",
            REPO_ID,
            EventRefs {
                task_id: updated["dependent_task_id"].as_str().map(str::to_string),
                artifact_id: proof_artifact_id.map(str::to_string),
                ..EventRefs::default()
            },
            json!({
                "dependency_edge_id": edge_id,
                "dependent_task_id": updated["dependent_task_id"].clone(),
                "prerequisite_kind": updated["prerequisite_kind"].clone(),
                "prerequisite_key": updated["prerequisite_key"].clone(),
                "predicate_kind": updated["predicate_kind"].clone(),
                "old_status": old_status,
                "new_status": new_status,
                "proof_event_id": proof_event_id,
                "proof_artifact_id": proof_artifact_id,
                "reason": reason,
            }),
        )?;
        Ok(updated)
    }

    fn evaluate_dependency_edge(&self, edge: &Value) -> Result<EdgeEvaluation, String> {
        let predicate_kind = edge["predicate_kind"].as_str().unwrap_or_default();
        match predicate_kind {
            "task_status_is" => self.evaluate_task_status_edge(edge),
            "patch_status_is" => self.evaluate_patch_status_edge(edge),
            "lease_released" => self.evaluate_lease_released_edge(edge),
            "resource_available" => self.evaluate_resource_available_edge(edge),
            "artifact_exists" => self.evaluate_artifact_exists_edge(edge),
            "approval_granted" => self.evaluate_approval_granted_edge(edge),
            "contract_certified" => self.evaluate_contract_certified_edge(edge),
            _ => Ok(EdgeEvaluation {
                status: "pending".to_string(),
                reason: format!("Predicate {predicate_kind} is not implemented."),
                proof_artifact_id: None,
            }),
        }
    }

    fn evaluate_task_status_edge(&self, edge: &Value) -> Result<EdgeEvaluation, String> {
        let Some(task_id) = dependency_prerequisite_task_id(
            edge["prerequisite_kind"].as_str().unwrap_or_default(),
            edge["prerequisite_key"].as_str().unwrap_or_default(),
            &edge["predicate_json"],
        ) else {
            return Ok(pending("task_status_is is missing a prerequisite task id"));
        };
        let rows = self.query_json("SELECT status FROM tasks WHERE id=?1", &[&task_id])?;
        let Some(task) = rows.first() else {
            return Ok(EdgeEvaluation {
                status: "invalidated".to_string(),
                reason: "Prerequisite task does not exist.".to_string(),
                proof_artifact_id: None,
            });
        };
        let status = task["status"].as_str().unwrap_or_default();
        let wanted = wanted_statuses(&edge["predicate_json"], &["merged"]);
        if wanted.iter().any(|wanted| wanted == status) {
            return Ok(EdgeEvaluation {
                status: "satisfied".to_string(),
                reason: format!("Prerequisite task reached {status}."),
                proof_artifact_id: None,
            });
        }
        if TERMINAL_TASK_STATUSES.contains(&status) {
            return Ok(EdgeEvaluation {
                status: "invalidated".to_string(),
                reason: format!("Prerequisite task ended as {status}, not one of {wanted:?}."),
                proof_artifact_id: None,
            });
        }
        Ok(EdgeEvaluation {
            status: "pending".to_string(),
            reason: format!("Prerequisite task is still {status}."),
            proof_artifact_id: None,
        })
    }

    fn evaluate_patch_status_edge(&self, edge: &Value) -> Result<EdgeEvaluation, String> {
        let patch_id = edge["prerequisite_key"]
            .as_str()
            .unwrap_or_default()
            .strip_prefix("patch:")
            .unwrap_or_else(|| edge["prerequisite_key"].as_str().unwrap_or_default());
        let rows = self.query_json("SELECT status FROM patches WHERE id=?1", &[&patch_id])?;
        let Some(patch) = rows.first() else {
            return Ok(EdgeEvaluation {
                status: "invalidated".to_string(),
                reason: "Prerequisite patch does not exist.".to_string(),
                proof_artifact_id: None,
            });
        };
        let status = patch["status"].as_str().unwrap_or_default();
        let wanted = wanted_statuses(&edge["predicate_json"], &["merged"]);
        if wanted.iter().any(|wanted| wanted == status) {
            return Ok(EdgeEvaluation {
                status: "satisfied".to_string(),
                reason: format!("Prerequisite patch reached {status}."),
                proof_artifact_id: None,
            });
        }
        if TERMINAL_PATCH_STATUSES.contains(&status) {
            return Ok(EdgeEvaluation {
                status: "invalidated".to_string(),
                reason: format!("Prerequisite patch ended as {status}, not one of {wanted:?}."),
                proof_artifact_id: None,
            });
        }
        Ok(EdgeEvaluation {
            status: "pending".to_string(),
            reason: format!("Prerequisite patch is still {status}."),
            proof_artifact_id: None,
        })
    }

    fn evaluate_lease_released_edge(&self, edge: &Value) -> Result<EdgeEvaluation, String> {
        let lease_id = edge["predicate_json"]["lease_id"]
            .as_str()
            .or_else(|| edge["predicate_json"]["blocked_by_lease_id"].as_str())
            .unwrap_or_default();
        if lease_id.is_empty() {
            return Ok(pending("lease_released is missing lease_id"));
        }
        let rows = self.query_json("SELECT status FROM leases WHERE id=?1", &[&lease_id])?;
        let Some(lease) = rows.first() else {
            return Ok(EdgeEvaluation {
                status: "satisfied".to_string(),
                reason: "Blocking lease no longer exists.".to_string(),
                proof_artifact_id: None,
            });
        };
        let status = lease["status"].as_str().unwrap_or_default();
        if status == "active" {
            Ok(EdgeEvaluation {
                status: "pending".to_string(),
                reason: "Blocking lease is still active.".to_string(),
                proof_artifact_id: None,
            })
        } else {
            Ok(EdgeEvaluation {
                status: "satisfied".to_string(),
                reason: format!("Blocking lease is {status}."),
                proof_artifact_id: None,
            })
        }
    }

    fn evaluate_resource_available_edge(&self, edge: &Value) -> Result<EdgeEvaluation, String> {
        let resource_key = edge["prerequisite_key"]
            .as_str()
            .unwrap_or_default()
            .strip_prefix("resource:")
            .unwrap_or_else(|| edge["prerequisite_key"].as_str().unwrap_or_default());
        if resource_key.is_empty() {
            return Ok(pending("resource_available is missing a resource key"));
        }
        let resource_key = normalize_resource_key(resource_key);
        let mode = edge["predicate_json"]["mode"].as_str().unwrap_or("write");
        let active = self.query_json(
            "SELECT l.id, l.task_id, l.mode, r.resource_key
             FROM leases l
             JOIN resources r ON r.id=l.resource_id
             WHERE l.status='active'
             ORDER BY l.acquired_at ASC",
            &[],
        )?;
        let blockers = active
            .into_iter()
            .filter(|lease| {
                let active_key = lease["resource_key"].as_str().unwrap_or_default();
                let active_mode = lease["mode"].as_str().unwrap_or_default();
                resource_conflict_reason(active_key, &resource_key).is_some()
                    && lease_mode_conflict_reason(active_mode, mode).is_some()
            })
            .collect::<Vec<_>>();
        if blockers.is_empty() {
            Ok(EdgeEvaluation {
                status: "satisfied".to_string(),
                reason: format!("{resource_key} has no active conflicting leases."),
                proof_artifact_id: None,
            })
        } else {
            Ok(EdgeEvaluation {
                status: "pending".to_string(),
                reason: format!("{resource_key} is still blocked by active leases."),
                proof_artifact_id: None,
            })
        }
    }

    fn evaluate_artifact_exists_edge(&self, edge: &Value) -> Result<EdgeEvaluation, String> {
        let key = edge["prerequisite_key"].as_str().unwrap_or_default();
        let artifact_id = key
            .strip_prefix("artifact:")
            .unwrap_or(key)
            .trim()
            .to_string();
        let rows = if !artifact_id.is_empty() && artifact_id != "*" {
            self.query_json(
                "SELECT id FROM artifacts WHERE id=?1 LIMIT 1",
                &[&artifact_id],
            )?
        } else {
            let artifact_kind = edge["predicate_json"]["artifact_kind"]
                .as_str()
                .unwrap_or_default();
            let task_id = edge["predicate_json"]["task_id"]
                .as_str()
                .or_else(|| edge["predicate_json"]["producer_task_id"].as_str());
            if artifact_kind.is_empty() {
                return Ok(pending(
                    "artifact_exists is missing artifact_id or artifact_kind",
                ));
            }
            if let Some(task_id) = task_id {
                self.query_json(
                    "SELECT id FROM artifacts WHERE task_id=?1 AND artifact_kind=?2 LIMIT 1",
                    &[&task_id, &artifact_kind],
                )?
            } else {
                self.query_json(
                    "SELECT id FROM artifacts WHERE artifact_kind=?1 LIMIT 1",
                    &[&artifact_kind],
                )?
            }
        };
        if let Some(row) = rows.first() {
            Ok(EdgeEvaluation {
                status: "satisfied".to_string(),
                reason: "Required artifact exists.".to_string(),
                proof_artifact_id: row["id"].as_str().map(str::to_string),
            })
        } else {
            Ok(pending("Required artifact does not exist yet."))
        }
    }

    fn evaluate_approval_granted_edge(&self, edge: &Value) -> Result<EdgeEvaluation, String> {
        let approval_id = edge["prerequisite_key"]
            .as_str()
            .unwrap_or_default()
            .strip_prefix("approval:")
            .unwrap_or_else(|| edge["prerequisite_key"].as_str().unwrap_or_default());
        if approval_id.is_empty() {
            return Ok(pending("approval_granted is missing an approval id"));
        }
        let rows = self.query_json("SELECT status FROM approvals WHERE id=?1", &[&approval_id])?;
        let Some(approval) = rows.first() else {
            return Ok(pending("Approval does not exist yet."));
        };
        let status = approval["status"].as_str().unwrap_or_default();
        if matches!(status, "approved" | "granted") {
            Ok(EdgeEvaluation {
                status: "satisfied".to_string(),
                reason: "Approval was granted.".to_string(),
                proof_artifact_id: None,
            })
        } else if matches!(status, "denied" | "rejected" | "cancelled") {
            Ok(EdgeEvaluation {
                status: "invalidated".to_string(),
                reason: format!("Approval ended as {status}."),
                proof_artifact_id: None,
            })
        } else {
            Ok(EdgeEvaluation {
                status: "pending".to_string(),
                reason: format!("Approval is still {status}."),
                proof_artifact_id: None,
            })
        }
    }

    fn evaluate_contract_certified_edge(&self, edge: &Value) -> Result<EdgeEvaluation, String> {
        let contract_name = edge["prerequisite_key"]
            .as_str()
            .unwrap_or_default()
            .strip_prefix("contract:")
            .unwrap_or_else(|| edge["prerequisite_key"].as_str().unwrap_or_default());
        if contract_name.is_empty() {
            return Ok(pending("contract_certified is missing a contract key"));
        }
        let rows = self.query_json(
            "SELECT id, evidence_artifact_id
             FROM memories
             WHERE memory_kind='contract'
               AND trust_level='certified'
               AND (title=?1 OR title=?2)
             ORDER BY updated_at DESC
             LIMIT 1",
            &[&contract_name, &format!("Contract: {contract_name}")],
        )?;
        if let Some(memory) = rows.first() {
            Ok(EdgeEvaluation {
                status: "satisfied".to_string(),
                reason: "Contract memory is certified.".to_string(),
                proof_artifact_id: memory["evidence_artifact_id"].as_str().map(str::to_string),
            })
        } else {
            Ok(pending("Contract memory is not certified yet."))
        }
    }

    fn dependency_edge_by_id(&self, dependency_edge_id: &str) -> Result<Value, String> {
        let mut rows = self.query_json(
            "SELECT * FROM dependency_edges WHERE id=?1 LIMIT 1",
            &[&dependency_edge_id],
        )?;
        rows.pop()
            .ok_or_else(|| "Dependency edge does not exist.".to_string())
    }

    fn ensure_dependency_task_exists(&self, task_id: &str) -> Result<(), String> {
        let count: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(1) FROM tasks WHERE id=?1",
                params![task_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Unable to inspect task existence: {error}"))?;
        if count == 0 {
            return Err(format!("Task does not exist: {task_id}"));
        }
        Ok(())
    }

    fn dependency_edge_would_cycle(
        &self,
        dependent_task_id: &str,
        prerequisite_task_id: &str,
    ) -> Result<bool, String> {
        if dependent_task_id == prerequisite_task_id {
            return Ok(true);
        }
        let count: i64 = self
            .conn
            .query_row(
                "WITH RECURSIVE dependency_tree(id) AS (
                    SELECT ?1
                    UNION
                    SELECT d.depends_on_task_id
                    FROM task_dependencies d
                    JOIN dependency_tree tree ON d.task_id = tree.id
                    UNION
                    SELECT CASE
                        WHEN e.prerequisite_kind='task' AND e.prerequisite_key LIKE 'task:%'
                            THEN substr(e.prerequisite_key, 6)
                        WHEN e.prerequisite_kind='task'
                            THEN e.prerequisite_key
                        ELSE json_extract(e.predicate_json, '$.blocked_by_task_id')
                    END
                    FROM dependency_edges e
                    JOIN dependency_tree tree ON e.dependent_task_id = tree.id
                    WHERE e.required=1
                      AND e.status IN ('pending', 'invalidated', 'expired', 'cycle_prevented')
                      AND (
                        e.prerequisite_kind='task'
                        OR json_extract(e.predicate_json, '$.blocked_by_task_id') IS NOT NULL
                      )
                 )
                 SELECT COUNT(1)
                 FROM dependency_tree
                 WHERE id=?2",
                params![prerequisite_task_id, dependent_task_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Unable to inspect dependency graph cycle: {error}"))?;
        Ok(count > 0)
    }
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{key} is required."))
}

fn normalize_dependency_kind(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase().replace('-', "_");
    match normalized.as_str() {
        "task" | "resource" | "patch" | "artifact" | "contract" | "approval" | "test"
        | "db_migration" => Ok(normalized),
        _ => Err(format!("Unknown prerequisite_kind: {value}")),
    }
}

fn normalize_prerequisite_key(kind: &str, key: &str) -> String {
    let trimmed = key.trim();
    match kind {
        "resource" => {
            let raw = trimmed.strip_prefix("resource:").unwrap_or(trimmed);
            normalize_resource_key(raw)
        }
        "task" if !trimmed.starts_with("task:") => format!("task:{trimmed}"),
        "patch" if !trimmed.starts_with("patch:") => format!("patch:{trimmed}"),
        "artifact" if !trimmed.starts_with("artifact:") => format!("artifact:{trimmed}"),
        "contract" if !trimmed.starts_with("contract:") => {
            format!("contract:{}", trimmed.to_ascii_lowercase())
        }
        "approval" if !trimmed.starts_with("approval:") => format!("approval:{trimmed}"),
        _ => trimmed.to_string(),
    }
}

fn normalize_predicate_kind(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase().replace('-', "_");
    if normalized.is_empty() {
        return Err("predicate_kind is required.".to_string());
    }
    Ok(normalized)
}

fn validate_predicate_kind(value: &str) -> Result<(), String> {
    match value {
        "task_status_is" | "patch_status_is" | "lease_released" | "resource_available"
        | "artifact_exists" | "approval_granted" | "contract_certified" => Ok(()),
        _ => Err(format!("Unknown predicate_kind: {value}")),
    }
}

fn normalize_dependency_status(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase().replace('-', "_");
    match normalized.as_str() {
        "pending" | "satisfied" | "invalidated" | "cancelled" | "expired" | "cycle_prevented" => {
            Ok(normalized)
        }
        _ => Err(format!("Unknown dependency status: {value}")),
    }
}

fn normalize_predicate_json(value: Value) -> Value {
    match value {
        Value::Null => json!({}),
        Value::Object(_) => value,
        other => json!({"value": other}),
    }
}

fn dependency_prerequisite_task_id(
    prerequisite_kind: &str,
    prerequisite_key: &str,
    predicate_json: &Value,
) -> Option<String> {
    if prerequisite_kind == "task" {
        return Some(
            prerequisite_key
                .strip_prefix("task:")
                .unwrap_or(prerequisite_key)
                .to_string(),
        );
    }
    predicate_json["blocked_by_task_id"]
        .as_str()
        .map(str::to_string)
}

fn wanted_statuses(predicate_json: &Value, default: &[&str]) -> Vec<String> {
    if let Some(status) = predicate_json["status"].as_str() {
        return vec![status.to_string()];
    }
    if let Some(status) = predicate_json["target_status"].as_str() {
        return vec![status.to_string()];
    }
    if let Some(statuses) = predicate_json["statuses"].as_array() {
        let values = statuses
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>();
        if !values.is_empty() {
            return values;
        }
    }
    default.iter().map(|value| value.to_string()).collect()
}

fn pending(reason: &str) -> EdgeEvaluation {
    EdgeEvaluation {
        status: "pending".to_string(),
        reason: reason.to_string(),
        proof_artifact_id: None,
    }
}

fn dependency_explanation(edge: &Value) -> Value {
    let predicate = edge["predicate_kind"].as_str().unwrap_or("unknown");
    let prerequisite = edge["prerequisite_key"].as_str().unwrap_or("unknown");
    let status = edge["status"].as_str().unwrap_or("unknown");
    let message = match predicate {
        "task_status_is" => {
            format!("Waiting for {prerequisite} to reach the required task status.")
        }
        "patch_status_is" => {
            format!("Waiting for {prerequisite} to reach the required patch status.")
        }
        "lease_released" => format!("Waiting for a blocking lease on {prerequisite} to release."),
        "resource_available" => {
            format!("Waiting for {prerequisite} to have no conflicting active leases.")
        }
        "artifact_exists" => format!("Waiting for required artifact {prerequisite}."),
        "approval_granted" => format!("Waiting for approval {prerequisite}."),
        "contract_certified" => format!("Waiting for certified contract {prerequisite}."),
        _ => format!("Waiting for predicate {predicate} on {prerequisite}."),
    };
    json!({
        "dependency_edge_id": edge["id"].clone(),
        "status": status,
        "predicate_kind": predicate,
        "prerequisite_key": prerequisite,
        "message": message,
    })
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process::Command};

    use serde_json::json;

    use super::*;

    fn init_git_repo(name: &str) -> std::path::PathBuf {
        let repo = std::env::temp_dir().join(format!(
            "diffforge_dependency_graph_test_{}_{}",
            name,
            Uuid::new_v4()
        ));
        fs::create_dir_all(&repo).unwrap();
        run(&repo, "git", &["init"]);
        fs::write(repo.join("src.txt"), "initial\n").unwrap();
        run(&repo, "git", &["add", "src.txt"]);
        run(
            &repo,
            "git",
            &[
                "-c",
                "user.email=test@example.com",
                "-c",
                "user.name=Test",
                "commit",
                "-m",
                "init",
            ],
        );
        repo
    }

    fn run(cwd: &Path, command: &str, args: &[&str]) {
        let output = Command::new(command)
            .current_dir(cwd)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{} failed: {}",
            command,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn predicate_task_dependency_blocks_then_satisfies() {
        let repo = init_git_repo("task_predicate");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let task_a = kernel
            .create_task("Build prerequisite", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_b = kernel
            .create_task("Consume prerequisite", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_a_id = task_a["id"].as_str().unwrap();
        let task_b_id = task_b["id"].as_str().unwrap();

        kernel
            .create_dependency(&json!({
                "task_id": task_b_id,
                "prerequisite_kind": "task",
                "prerequisite_key": task_a_id,
                "predicate_kind": "task_status_is",
                "predicate_json": {"status": "merged"},
                "created_by_type": "kernel",
                "created_by_id": "test"
            }))
            .unwrap();
        assert_eq!(
            kernel.blocking_dependency_edges(task_b_id).unwrap().len(),
            1
        );

        kernel
            .conn
            .execute(
                "UPDATE tasks SET status='merged', updated_at=?1 WHERE id=?2",
                params![now_rfc3339(), task_a_id],
            )
            .unwrap();
        kernel
            .reevaluate_dependency_edges_for_prerequisite_task(task_a_id, None)
            .unwrap();
        assert!(kernel
            .blocking_dependency_edges(task_b_id)
            .unwrap()
            .is_empty());
        let task = kernel
            .query_json("SELECT status FROM tasks WHERE id=?1", &[&task_b_id])
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(task["status"].as_str(), Some("ready"));
    }

    #[test]
    fn cycle_prevention_records_auditable_edge() {
        let repo = init_git_repo("cycle");
        let kernel = CoordinationKernel::init(&repo, None).unwrap();
        let task_a = kernel
            .create_task("A", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_b = kernel
            .create_task("B", None, 0, 1, None, None, None, None)
            .unwrap();
        let task_a_id = task_a["id"].as_str().unwrap();
        let task_b_id = task_b["id"].as_str().unwrap();

        kernel
            .create_dependency(&json!({
                "task_id": task_a_id,
                "prerequisite_kind": "task",
                "prerequisite_key": task_b_id,
                "predicate_kind": "task_status_is",
                "predicate_json": {"status": "merged"},
                "created_by_type": "kernel",
                "created_by_id": "test"
            }))
            .unwrap();
        let reverse = kernel
            .create_dependency(&json!({
                "task_id": task_b_id,
                "prerequisite_kind": "task",
                "prerequisite_key": task_a_id,
                "predicate_kind": "task_status_is",
                "predicate_json": {"status": "merged"},
                "created_by_type": "kernel",
                "created_by_id": "test"
            }))
            .unwrap();
        assert_eq!(
            reverse["data"]["dependency"]["edge"]["status"].as_str(),
            Some("cycle_prevented")
        );
    }
}
