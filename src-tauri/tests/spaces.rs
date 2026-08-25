#![allow(dead_code)]

// S0 deliberately does not include spaces.rs from lib.rs. This test target
// compiles the future include boundary without editing lib.rs; store tests use
// explicit in-memory connections, so this path is never opened.
fn sessions_database_path() -> Result<std::path::PathBuf, String> {
    Err("The standalone spaces test harness has no process database path.".to_string())
}

include!("../src/spaces.rs");

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(id: &str, session_ref: &str) -> SpaceLayoutNode {
        SpaceLayoutNode::Leaf {
            id: id.to_string(),
            session_ref: session_ref.to_string(),
            view_kind: SpaceViewKind::Chat,
            view_state: SpaceViewState::default(),
        }
    }

    fn stack(id: &str, tabs: Vec<SpaceLayoutNode>, active: &str) -> SpaceLayoutNode {
        SpaceLayoutNode::Stack {
            id: id.to_string(),
            tabs,
            active: active.to_string(),
        }
    }

    fn two_leaf_layout() -> SpaceLayout {
        SpaceLayout {
            members: vec!["session-live".to_string(), "session-gone".to_string()],
            root: Some(stack(
                "stack-main",
                vec![
                    leaf("leaf-live", "session-live"),
                    leaf("leaf-gone", "session-gone"),
                ],
                "leaf-live",
            )),
        }
    }

    fn saved_space(layout: SpaceLayout) -> SpaceRecord {
        SpaceRecord {
            id: "space-test".to_string(),
            name: "Test".to_string(),
            ordinal: 0,
            layout_json: serde_json::to_string(&layout.canonicalized()).unwrap(),
            focused_leaf: Some("leaf-live".to_string()),
            created_at_ms: 1,
            updated_at_ms: 2,
            schema_version: SPACES_SCHEMA_VERSION,
        }
    }

    #[test]
    fn schema_and_crud_are_versioned_atomic_and_canonical() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        spaces_initialize_database(&mut connection).unwrap();
        spaces_initialize_database(&mut connection).unwrap();

        assert_eq!(
            connection
                .query_row(
                    "SELECT version FROM spaces_schema WHERE singleton = 1",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            SPACES_SCHEMA_VERSION
        );
        assert_eq!(
            spaces_table_columns(&connection).unwrap(),
            [
                "id",
                "name",
                "ordinal",
                "layout_json",
                "focused_leaf",
                "created_at_ms",
                "updated_at_ms",
                "schema_version",
            ]
            .into_iter()
            .map(str::to_string)
            .collect()
        );

        let first = space_create_in_connection(
            &mut connection,
            " First ".to_string(),
            None,
            10,
            "space-first".to_string(),
        )
        .unwrap();
        let second = space_create_in_connection(
            &mut connection,
            "Second".to_string(),
            None,
            11,
            "space-second".to_string(),
        )
        .unwrap();
        assert_eq!((first.ordinal, second.ordinal), (0, 1));
        assert_eq!(first.layout_json, r#"{"members":[],"root":null}"#);

        let noncanonical_members = SpaceLayout {
            members: vec!["session-live".to_string(), "session-gone".to_string()],
            root: two_leaf_layout().root,
        };
        let noncanonical_error = space_save_layout_in_connection(
            &mut connection,
            &first.id,
            serde_json::to_string_pretty(&noncanonical_members).unwrap(),
            Some("leaf-live".to_string()),
            19,
        )
        .unwrap_err();
        assert!(noncanonical_error.contains("canonical-byte divergence"));
        assert_eq!(
            space_get_from_connection(&connection, &first.id)
                .unwrap()
                .layout_json,
            r#"{"members":[],"root":null}"#
        );
        let saved = space_save_layout_in_connection(
            &mut connection,
            &first.id,
            serde_json::to_string(&noncanonical_members.canonicalized()).unwrap(),
            Some("leaf-live".to_string()),
            20,
        )
        .unwrap();
        assert!(saved
            .layout_json
            .starts_with(r#"{"members":["session-gone","session-live"]"#));

        let stable_bytes = saved.layout_json.clone();
        let stable = space_save_layout_in_connection(
            &mut connection,
            &first.id,
            saved.layout_json,
            saved.focused_leaf,
            21,
        )
        .unwrap();
        assert_eq!(stable.layout_json, stable_bytes);

        let invalid = stable.layout_json.replace("leaf-live\"", "missing-leaf\"");
        let error = space_save_layout_in_connection(
            &mut connection,
            &first.id,
            invalid,
            Some("leaf-live".to_string()),
            22,
        )
        .unwrap_err();
        assert!(error.contains("active leaf") || error.contains("Focused leaf"));
        assert_eq!(
            space_get_from_connection(&connection, &first.id)
                .unwrap()
                .layout_json,
            stable_bytes
        );

        let renamed =
            space_rename_in_connection(&mut connection, &second.id, "Renamed".to_string(), 30)
                .unwrap();
        assert_eq!(renamed.name, "Renamed");
        assert_eq!(
            spaces_list_from_connection(&connection)
                .unwrap()
                .into_iter()
                .map(|space| space.id)
                .collect::<Vec<_>>(),
            ["space-first", "space-second"]
        );
        space_delete_in_connection(&mut connection, &second.id).unwrap();
        assert_eq!(spaces_list_from_connection(&connection).unwrap().len(), 1);
    }

    #[test]
    fn fixed_struct_serializer_has_one_exact_wire_order() {
        let layout = SpaceLayout {
            members: vec!["b".to_string(), "a".to_string()],
            root: Some(SpaceLayoutNode::Split {
                id: "split-1".to_string(),
                direction: SpaceSplitDirection::Horizontal,
                children: vec![
                    stack("stack-a", vec![leaf("leaf-a", "a")], "leaf-a"),
                    stack("stack-b", vec![leaf("leaf-b", "b")], "leaf-b"),
                ],
                sizes: vec![2, 1],
            }),
        };
        let canonical = serde_json::to_string(&layout.clone().canonicalized()).unwrap();
        let (_, parsed_canonical) =
            spaces_parse_canonical_layout(&canonical, Some("leaf-a")).unwrap();
        assert_eq!(
            parsed_canonical,
            r#"{"members":["a","b"],"root":{"kind":"split","id":"split-1","direction":"horizontal","children":[{"kind":"stack","id":"stack-a","tabs":[{"kind":"leaf","id":"leaf-a","sessionRef":"a","viewKind":"chat","viewState":{"activeSubTab":null}}],"active":"leaf-a"},{"kind":"stack","id":"stack-b","tabs":[{"kind":"leaf","id":"leaf-b","sessionRef":"b","viewKind":"chat","viewState":{"activeSubTab":null}}],"active":"leaf-b"}],"sizes":[2,1]}}"#
        );
        let (_, second_save) = spaces_parse_canonical_layout(&canonical, Some("leaf-a")).unwrap();
        assert_eq!(second_save, canonical);

        let pretty_wire = serde_json::to_string_pretty(&layout.canonicalized()).unwrap();
        assert_eq!(
            spaces_parse_canonical_layout(&pretty_wire, Some("leaf-a")).unwrap_err(),
            SpaceLayoutDeserializationError::CanonicalByteDivergence
        );

        let float_wire = canonical.replace(r#""sizes":[2,1]"#, r#""sizes":[2.0,1]"#);
        assert_eq!(
            spaces_parse_canonical_layout(&float_wire, Some("leaf-a")).unwrap_err(),
            SpaceLayoutDeserializationError::CanonicalByteDivergence
        );
    }

    #[test]
    fn shared_cross_runtime_fixture_round_trips_byte_identically() {
        let fixture = include_str!("fixtures/spaces_canonical_layout.json");
        let (_, canonical) = spaces_parse_canonical_layout(fixture, Some("leaf-private")).unwrap();
        assert_eq!(canonical, fixture);
    }

    #[test]
    fn float_form_shared_fixture_is_rejected_as_canonical_divergence() {
        let fixture = include_str!("fixtures/spaces_canonical_layout.json");
        let float_form = fixture.replace(r#""sizes":[2,1]"#, r#""sizes":[2.0,1]"#);
        assert_ne!(float_form, fixture);
        assert_eq!(
            spaces_parse_canonical_layout(&float_form, Some("leaf-private")).unwrap_err(),
            SpaceLayoutDeserializationError::CanonicalByteDivergence
        );
    }

    #[test]
    fn key_reordered_shared_fixture_is_rejected_as_canonical_divergence() {
        let fixture = include_str!("fixtures/spaces_canonical_layout.json");
        let decoded = serde_json::from_str::<SpaceLayout>(fixture).unwrap();
        let root = serde_json::to_string(&decoded.root).unwrap();
        let members = serde_json::to_string(&decoded.members).unwrap();
        let key_reordered = format!(r#"{{"root":{root},"members":{members}}}"#);
        assert_eq!(
            spaces_parse_canonical_layout(&key_reordered, Some("leaf-private")).unwrap_err(),
            SpaceLayoutDeserializationError::CanonicalByteDivergence
        );
    }

    #[test]
    fn stack_duplicate_is_rejected_but_cross_pane_duplicate_is_valid() {
        let same_stack = SpaceLayout {
            members: vec!["session-a".to_string()],
            root: Some(stack(
                "stack-a",
                vec![leaf("leaf-a1", "session-a"), leaf("leaf-a2", "session-a")],
                "leaf-a1",
            )),
        };
        assert!(spaces_validate_layout(&same_stack, Some("leaf-a1"))
            .unwrap_err()
            .contains("duplicated within one stack"));

        let across_stacks = SpaceLayout {
            members: vec!["session-a".to_string()],
            root: Some(SpaceLayoutNode::Split {
                id: "split-main".to_string(),
                direction: SpaceSplitDirection::Horizontal,
                children: vec![
                    stack("stack-a", vec![leaf("leaf-a1", "session-a")], "leaf-a1"),
                    stack("stack-b", vec![leaf("leaf-a2", "session-a")], "leaf-a2"),
                ],
                sizes: vec![1, 1],
            }),
        };
        spaces_validate_layout(&across_stacks, Some("leaf-a2")).unwrap();

        let zero_weight = SpaceLayout {
            members: vec!["session-a".to_string()],
            root: Some(SpaceLayoutNode::Split {
                id: "split-zero".to_string(),
                direction: SpaceSplitDirection::Horizontal,
                children: vec![
                    stack(
                        "stack-zero-a",
                        vec![leaf("leaf-zero-a", "session-a")],
                        "leaf-zero-a",
                    ),
                    stack(
                        "stack-zero-b",
                        vec![leaf("leaf-zero-b", "session-a")],
                        "leaf-zero-b",
                    ),
                ],
                sizes: vec![0, 1],
            }),
        };
        assert!(spaces_validate_layout(&zero_weight, Some("leaf-zero-a"))
            .unwrap_err()
            .contains("positive integer weights"));
    }

    #[test]
    fn pin_reconciliation_distinguishes_live_tombstone_and_unreachable() {
        let space = saved_space(two_leaf_layout());
        let reachable = reconcile_space(
            &space,
            &SpaceRosterSnapshot::Reachable {
                session_refs: vec!["session-live".to_string()],
            },
        )
        .unwrap();
        assert_eq!(reachable[0].availability, SpaceLeafAvailability::Live);
        assert_eq!(reachable[1].availability, SpaceLeafAvailability::Tombstone);

        let empty = reconcile_space(
            &space,
            &SpaceRosterSnapshot::Reachable {
                session_refs: Vec::new(),
            },
        )
        .unwrap();
        assert!(empty
            .iter()
            .all(|leaf| leaf.availability == SpaceLeafAvailability::Tombstone));

        let unreachable = reconcile_space(
            &space,
            &SpaceRosterSnapshot::Unreachable {
                reason: "daemon connection lost".to_string(),
            },
        )
        .unwrap();
        assert!(unreachable.iter().all(|leaf| {
            leaf.availability
                == SpaceLeafAvailability::Unknown {
                    reason: "daemon connection lost".to_string(),
                }
        }));
        assert_eq!(
            serde_json::to_value(&unreachable[0]).unwrap(),
            serde_json::json!({
                "leaf_id": "leaf-live",
                "session_ref": "session-live",
                "state": "unknown",
                "reason": "daemon connection lost",
            })
        );
    }
}
