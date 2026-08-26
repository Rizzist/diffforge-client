#![allow(dead_code)]

// The production crate include!s workspace_view.rs after sessions.rs. This stub
// pins that boundary while store tests use explicit in-memory connections.
fn sessions_database_path() -> Result<std::path::PathBuf, String> {
    Err("The standalone workspace view test harness has no process database path.".to_string())
}

include!("../src/workspace_view.rs");

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> rusqlite::Connection {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        workspace_view_initialize_database(&mut connection).unwrap();
        connection
    }

    fn canonical_view(
        open_sessions: &[&str],
        active_target: WorkspaceViewActiveTarget,
        active_space_id: Option<&str>,
    ) -> String {
        serde_json::to_string(&WorkspaceView {
            open_sessions: open_sessions
                .iter()
                .map(|session_ref| (*session_ref).to_string())
                .collect(),
            active_target,
            active_space_id: active_space_id.map(str::to_string),
        })
        .unwrap()
    }

    #[allow(clippy::too_many_arguments)]
    fn upsert(
        connection: &mut rusqlite::Connection,
        profile_id: &str,
        id: &str,
        kind: BreakoutKind,
        session_ref: Option<&str>,
        space_id: Option<&str>,
        leaf_id: Option<&str>,
        geometry_json: Option<&str>,
        view_state_json: Option<&str>,
        now_ms: i64,
    ) -> Result<BreakoutRecord, String> {
        breakout_upsert_in_connection(
            connection,
            profile_id,
            id,
            kind,
            session_ref.map(str::to_string),
            space_id.map(str::to_string),
            leaf_id.map(str::to_string),
            geometry_json.map(str::to_string),
            view_state_json.map(str::to_string),
            now_ms,
        )
    }

    fn table_columns(connection: &rusqlite::Connection, table: &str) -> Vec<String> {
        let query = format!("PRAGMA table_info({table})");
        let mut statement = connection.prepare(&query).unwrap();
        statement
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    fn invalid_view_state_message(view_state_json: &str) -> String {
        match workspace_view_parse_canonical_view_state(view_state_json) {
            Err(BreakoutJsonDeserializationError::Invalid {
                field: BreakoutJsonField::ViewState,
                message,
            }) => message,
            other => panic!("expected typed invalid view-state error, got {other:?}"),
        }
    }

    #[test]
    fn schema_is_versioned_idempotent_and_exact() {
        let mut connection = connection();
        workspace_view_initialize_database(&mut connection).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT version FROM workspace_view_schema WHERE singleton = 1",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            WORKSPACE_VIEW_SCHEMA_VERSION
        );
        assert_eq!(
            table_columns(&connection, "workspace_view"),
            [
                "profile_id",
                "revision",
                "updated_at_ms",
                "schema_version",
                "view_json",
            ]
        );
        assert_eq!(
            table_columns(&connection, "breakout_window"),
            [
                "id",
                "profile_id",
                "kind",
                "session_ref",
                "space_id",
                "leaf_id",
                "geometry_json",
                "view_state_json",
                "revision",
                "updated_at_ms",
                "schema_version",
            ]
        );
    }

    #[test]
    fn canonical_workspace_view_bytes_round_trip_stably() {
        let canonical = canonical_view(
            &["session-b", "session-a"],
            WorkspaceViewActiveTarget::Session {
                session_ref: "session-b".to_string(),
            },
            None,
        );
        assert_eq!(
            canonical,
            r#"{"open_sessions":["session-b","session-a"],"active_target":{"kind":"session","session_ref":"session-b"},"active_space_id":null}"#
        );
        let (decoded, first) = workspace_view_parse_canonical_view(&canonical).unwrap();
        let (_, second) = workspace_view_parse_canonical_view(&first).unwrap();
        assert_eq!(decoded.open_sessions, ["session-b", "session-a"]);
        assert_eq!(first, canonical);
        assert_eq!(second, canonical);
    }

    #[test]
    fn noncanonical_stored_workspace_view_fails_closed() {
        let canonical = canonical_view(&["session-a"], WorkspaceViewActiveTarget::Home, None);
        let pretty = serde_json::to_string_pretty(
            &serde_json::from_str::<serde_json::Value>(&canonical).unwrap(),
        )
        .unwrap();
        assert_eq!(
            workspace_view_parse_canonical_view(&pretty).unwrap_err(),
            WorkspaceViewDeserializationError::CanonicalByteDivergence
        );

        let connection = connection();
        connection
            .execute(
                "INSERT INTO workspace_view (
                    profile_id, revision, updated_at_ms, schema_version, view_json
                 ) VALUES (?1, 1, 10, ?2, ?3)",
                rusqlite::params!["profile-a", WORKSPACE_VIEW_SCHEMA_VERSION, pretty],
            )
            .unwrap();
        let error = workspace_view_get_from_connection(&connection, "profile-a").unwrap_err();
        assert!(
            error.contains("Workspace view canonical-byte divergence"),
            "the stored row must surface the typed divergence instead of being normalized: {error}"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT view_json FROM workspace_view WHERE profile_id = 'profile-a'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            pretty,
            "a failed read must not rewrite noncanonical bytes"
        );
    }

    #[test]
    fn stale_workspace_view_revision_is_rejected() {
        let mut connection = connection();
        let first_json = canonical_view(&[], WorkspaceViewActiveTarget::Home, None);
        let first =
            workspace_view_save_in_connection(&mut connection, "profile-a", first_json, None, 10)
                .unwrap();
        assert_eq!(first.revision, 1);

        let second_json = canonical_view(
            &["session-a"],
            WorkspaceViewActiveTarget::Session {
                session_ref: "session-a".to_string(),
            },
            None,
        );
        let second = workspace_view_save_in_connection(
            &mut connection,
            "profile-a",
            second_json,
            Some(first.revision),
            20,
        )
        .unwrap();
        assert_eq!(second.revision, 2);

        let stale_json = canonical_view(
            &[],
            WorkspaceViewActiveTarget::Space {
                space_id: "space-stale".to_string(),
            },
            Some("space-stale"),
        );
        let error = workspace_view_save_in_connection(
            &mut connection,
            "profile-a",
            stale_json,
            Some(first.revision),
            30,
        )
        .unwrap_err();
        assert_eq!(
            error,
            "Workspace view revision conflict: expected 1, current 2."
        );
        assert_eq!(
            workspace_view_get_from_connection(&connection, "profile-a")
                .unwrap()
                .unwrap(),
            second,
            "a rejected stale write must leave revision, bytes, and timestamp unchanged"
        );
    }

    #[test]
    fn open_session_order_is_preserved() {
        let mut connection = connection();
        let view_json = canonical_view(
            &["session-third", "session-first", "session-second"],
            WorkspaceViewActiveTarget::Home,
            None,
        );
        let saved = workspace_view_save_in_connection(
            &mut connection,
            "profile-order",
            view_json.clone(),
            None,
            10,
        )
        .unwrap();
        let (decoded, _) = workspace_view_parse_canonical_view(&saved.view_json).unwrap();
        assert_eq!(
            decoded.open_sessions,
            ["session-third", "session-first", "session-second"]
        );
        assert_eq!(saved.view_json, view_json);
    }

    #[test]
    fn active_target_tags_round_trip_exactly() {
        let cases = [
            (
                WorkspaceViewActiveTarget::Session {
                    session_ref: "session-a".to_string(),
                },
                r#"{"kind":"session","session_ref":"session-a"}"#,
            ),
            (
                WorkspaceViewActiveTarget::Space {
                    space_id: "space-a".to_string(),
                },
                r#"{"kind":"space","space_id":"space-a"}"#,
            ),
            (WorkspaceViewActiveTarget::Home, r#"{"kind":"home"}"#),
        ];
        for (target, expected) in cases {
            let encoded = serde_json::to_string(&target).unwrap();
            assert_eq!(encoded, expected);
            assert_eq!(
                serde_json::from_str::<WorkspaceViewActiveTarget>(&encoded).unwrap(),
                target
            );
        }
    }

    #[test]
    fn breakout_kind_coordinates_are_integral() {
        workspace_view_validate_breakout_coordinates(
            BreakoutKind::Session,
            Some("session-a"),
            None,
            None,
        )
        .unwrap();
        workspace_view_validate_breakout_coordinates(
            BreakoutKind::SpaceLeaf,
            None,
            Some("space-a"),
            Some("leaf-a"),
        )
        .unwrap();
        assert!(workspace_view_validate_breakout_coordinates(
            BreakoutKind::Session,
            Some("session-a"),
            Some("space-a"),
            None,
        )
        .unwrap_err()
        .contains("forbids"));
        assert!(workspace_view_validate_breakout_coordinates(
            BreakoutKind::SpaceLeaf,
            Some("session-a"),
            Some("space-a"),
            Some("leaf-a"),
        )
        .unwrap_err()
        .contains("forbids"));

        let mut connection = connection();
        let session = upsert(
            &mut connection,
            "profile-a",
            "breakout-session",
            BreakoutKind::Session,
            Some("session-a"),
            None,
            None,
            None,
            None,
            10,
        )
        .unwrap();
        let leaf = upsert(
            &mut connection,
            "profile-a",
            "breakout-leaf",
            BreakoutKind::SpaceLeaf,
            None,
            Some("space-a"),
            Some("leaf-a"),
            None,
            None,
            11,
        )
        .unwrap();
        assert_eq!(session.kind, BreakoutKind::Session);
        assert_eq!(leaf.kind, BreakoutKind::SpaceLeaf);
        assert!(
            connection
                .execute(
                    "INSERT INTO breakout_window (
                    id, profile_id, kind, session_ref, space_id, leaf_id,
                    geometry_json, view_state_json, revision, updated_at_ms, schema_version
                 ) VALUES ('invalid', 'profile-a', 'session', 'session-a', 'space-a', NULL,
                    NULL, NULL, 1, 12, ?1)",
                    [WORKSPACE_VIEW_SCHEMA_VERSION],
                )
                .is_err(),
            "the SQLite CHECK must independently enforce breakout coordinate integrity"
        );
    }

    #[test]
    fn absent_breakout_geometry_remains_absent() {
        let mut connection = connection();
        let record = upsert(
            &mut connection,
            "profile-a",
            "breakout-unknown-geometry",
            BreakoutKind::Session,
            Some("session-a"),
            None,
            None,
            None,
            None,
            10,
        )
        .unwrap();
        assert_eq!(record.geometry_json, None);
        assert_eq!(
            connection
                .query_row(
                    "SELECT geometry_json IS NULL FROM breakout_window WHERE id = ?1",
                    [&record.id],
                    |row| row.get::<_, bool>(0),
                )
                .unwrap(),
            true,
            "unknown geometry must be SQL NULL, never a default rectangle"
        );
        assert_eq!(
            breakout_list_from_connection(&connection, "profile-a").unwrap()[0].geometry_json,
            None
        );
    }

    #[test]
    fn breakout_geometry_and_view_state_use_canonical_bytes() {
        let geometry =
            r#"{"width":1200,"height":800,"x":-20,"maximized":false,"display":"display-a"}"#;
        let (_, stable_geometry) = workspace_view_parse_canonical_geometry(geometry).unwrap();
        assert_eq!(stable_geometry, geometry);
        assert!(matches!(
            workspace_view_parse_canonical_geometry(
                r#"{"height":800,"width":1200,"x":-20,"maximized":false,"display":"display-a"}"#
            ),
            Err(BreakoutJsonDeserializationError::CanonicalByteDivergence(
                BreakoutJsonField::Geometry
            ))
        ));

        let view_state = r#"{"activeSubTab":"trajectory","viewMode":"ui"}"#;
        let (_, stable_view_state) = workspace_view_parse_canonical_view_state(view_state).unwrap();
        assert_eq!(stable_view_state, view_state);
        assert!(matches!(
            workspace_view_parse_canonical_view_state(
                r#"{"viewMode":"ui","activeSubTab":"trajectory"}"#
            ),
            Err(BreakoutJsonDeserializationError::CanonicalByteDivergence(
                BreakoutJsonField::ViewState
            ))
        ));
        assert!(workspace_view_parse_canonical_view_state("null").is_err());
    }

    #[test]
    fn breakout_schema_has_no_native_lifecycle_columns() {
        let connection = connection();
        let columns = table_columns(&connection, "breakout_window");
        assert!(!columns.iter().any(|column| {
            let normalized = column.replace('_', "");
            normalized.contains("windowlabel") || normalized.contains("incarnation")
        }));
        for lifecycle_collection in [
            r#"{"nativeWindowLabel":"breakout-17"}"#,
            r#"{"native_window_labels":["breakout-17"]}"#,
            r#"{"incarnation_id":"process-44"}"#,
            r#"{"incarnation_ids":["process-44"]}"#,
        ] {
            assert!(invalid_view_state_message(lifecycle_collection).contains("allowlist"));
        }
    }

    #[test]
    fn breakout_view_state_rejects_forbidden_authority_aliases() {
        for copied_authority in [
            r#"{"roster_summary":"copied"}"#,
            r#"{"rosterSummary":"copied"}"#,
            r#"{"head_seq":42}"#,
            r#"{"headSeq":42}"#,
            r#"{"run_status":"running"}"#,
            r#"{"runStatus":"running"}"#,
            r#"{"account_facts":"copied"}"#,
            r#"{"accountFacts":"copied"}"#,
            r#"{"account":"copied"}"#,
        ] {
            assert!(
                invalid_view_state_message(copied_authority).contains("allowlist"),
                "forbidden authority alias was not rejected: {copied_authority}"
            );
        }
    }

    #[test]
    fn breakout_view_state_allowlist_round_trips_canonically() {
        let canonical = r#"{"activeSubTab":"trajectory","viewMode":"ui"}"#;
        let (decoded, first) = workspace_view_parse_canonical_view_state(canonical).unwrap();
        let (_, second) = workspace_view_parse_canonical_view_state(&first).unwrap();
        assert_eq!(
            decoded,
            serde_json::json!({"activeSubTab": "trajectory", "viewMode": "ui"})
        );
        assert_eq!(first, canonical);
        assert_eq!(second, canonical);
    }

    #[test]
    fn breakout_view_state_rejects_novel_unknown_key() {
        let message = invalid_view_state_message(r#"{"novelPresentationFact":"smuggled"}"#);
        assert!(message.contains("allowlist"), "unexpected error: {message}");
    }

    #[test]
    fn breakout_view_state_rejects_nested_smuggling() {
        let message =
            invalid_view_state_message(r#"{"activeSubTab":{"rosterSummary":["session-a"]}}"#);
        assert!(
            message.contains("does not allow nested objects or arrays"),
            "unexpected error: {message}"
        );
    }

    #[test]
    fn breakout_crud_is_profile_scoped_and_idempotent_by_id() {
        let mut connection = connection();
        let first = upsert(
            &mut connection,
            "profile-a",
            "breakout-a",
            BreakoutKind::Session,
            Some("session-a"),
            None,
            None,
            Some(r#"{"width":800,"height":600}"#),
            Some(r#"{"activeSubTab":null,"viewMode":"ui"}"#),
            10,
        )
        .unwrap();
        let second = upsert(
            &mut connection,
            "profile-a",
            "breakout-a",
            BreakoutKind::Session,
            Some("session-b"),
            None,
            None,
            None,
            Some(r#"{"activeSubTab":"trajectory","viewMode":"ui"}"#),
            20,
        )
        .unwrap();
        assert_eq!((first.revision, second.revision), (1, 2));
        assert_eq!(
            breakout_list_from_connection(&connection, "profile-a").unwrap(),
            [second.clone()]
        );
        assert!(breakout_list_from_connection(&connection, "profile-b")
            .unwrap()
            .is_empty());
        assert!(upsert(
            &mut connection,
            "profile-b",
            "breakout-a",
            BreakoutKind::Session,
            Some("session-other"),
            None,
            None,
            None,
            None,
            30,
        )
        .unwrap_err()
        .contains("another profile"));
        breakout_remove_in_connection(&mut connection, "profile-b", "breakout-a").unwrap();
        assert_eq!(
            breakout_list_from_connection(&connection, "profile-a").unwrap(),
            [second]
        );
        breakout_remove_in_connection(&mut connection, "profile-a", "breakout-a").unwrap();
        breakout_remove_in_connection(&mut connection, "profile-a", "breakout-a").unwrap();
        assert!(breakout_list_from_connection(&connection, "profile-a")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn breakout_clear_missing_only_removes_unkept_ids_for_one_profile() {
        let mut connection = connection();
        for (profile, id) in [
            ("profile-a", "a-keep"),
            ("profile-a", "a-drop"),
            ("profile-b", "b-keep"),
        ] {
            upsert(
                &mut connection,
                profile,
                id,
                BreakoutKind::Session,
                Some("session-a"),
                None,
                None,
                None,
                None,
                10,
            )
            .unwrap();
        }
        breakout_clear_missing_in_connection(
            &mut connection,
            "profile-a",
            vec!["a-keep".to_string()],
        )
        .unwrap();
        assert_eq!(
            breakout_list_from_connection(&connection, "profile-a")
                .unwrap()
                .into_iter()
                .map(|record| record.id)
                .collect::<Vec<_>>(),
            ["a-keep"]
        );
        assert_eq!(
            breakout_list_from_connection(&connection, "profile-b")
                .unwrap()
                .into_iter()
                .map(|record| record.id)
                .collect::<Vec<_>>(),
            ["b-keep"]
        );
        breakout_clear_missing_in_connection(&mut connection, "profile-a", Vec::new()).unwrap();
        assert!(breakout_list_from_connection(&connection, "profile-a")
            .unwrap()
            .is_empty());
        assert_eq!(
            breakout_list_from_connection(&connection, "profile-b")
                .unwrap()
                .len(),
            1
        );
    }
}
