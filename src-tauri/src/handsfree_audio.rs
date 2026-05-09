const AUDIO_PUSH_TO_TALK_SHORTCUT: &str = "P";
const AUDIO_PUSH_TO_TALK_EVENT: &str = "forge-audio-push-to-talk";
const AUDIO_PUSH_TO_TALK_PRESS_EMIT_DELAY_MS: u64 = 140;
const AUDIO_HANDSFREE_INSERT_DELAY_MS: u64 = 160;

static AUDIO_PUSH_TO_TALK_IS_DOWN: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioPushToTalkEvent {
    phase: &'static str,
    pressed: bool,
    shortcut: &'static str,
    created_at_ms: u64,
}

fn emit_audio_push_to_talk_event(app: &AppHandle, phase: &'static str, pressed: bool) {
    let _ = app.emit(
        AUDIO_PUSH_TO_TALK_EVENT,
        AudioPushToTalkEvent {
            phase,
            pressed,
            shortcut: AUDIO_PUSH_TO_TALK_SHORTCUT,
            created_at_ms: current_time_ms(),
        },
    );
}

fn show_audio_widget_for_handsfree(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    let status = whisper_model_status_for(app)?;
    let window = ensure_audio_widget_window(app)?;
    window
        .show()
        .map_err(|error| format!("Unable to show audio widget: {error}"))?;

    Ok(AudioWidgetVisibility {
        visible: true,
        installed: status.installed,
        shortcut: AUDIO_SHORTCUT,
    })
}

fn handle_audio_push_to_talk_state(app: AppHandle, state: ShortcutState) {
    match state {
        ShortcutState::Pressed => {
            if AUDIO_PUSH_TO_TALK_IS_DOWN.swap(true, Ordering::AcqRel) {
                return;
            }

            tauri::async_runtime::spawn(async move {
                if let Ok(visibility) = show_audio_widget_for_handsfree(&app) {
                    if visibility.installed {
                        let prepare_app = app.clone();
                        let engine = app.state::<AudioState>().whisper_engine.clone();
                        let _ = tauri::async_runtime::spawn_blocking(move || {
                            let _ = prepare_whisper_model_for(&prepare_app, &engine);
                        });
                    }
                }

                tokio::time::sleep(Duration::from_millis(
                    AUDIO_PUSH_TO_TALK_PRESS_EMIT_DELAY_MS,
                ))
                .await;

                if AUDIO_PUSH_TO_TALK_IS_DOWN.load(Ordering::Acquire) {
                    emit_audio_push_to_talk_event(&app, "pressed", true);
                }
            });
        }
        ShortcutState::Released => {
            if !AUDIO_PUSH_TO_TALK_IS_DOWN.swap(false, Ordering::AcqRel) {
                return;
            }

            tauri::async_runtime::spawn(async move {
                emit_audio_push_to_talk_event(&app, "released", false);
            });
        }
    }
}

fn register_audio_push_to_talk_shortcut(app: &AppHandle) {
    let shortcut = Shortcut::new(None, Code::KeyP);

    if let Err(error) = app
        .global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            handle_audio_push_to_talk_state(app.clone(), event.state);
        })
    {
        eprintln!("Unable to register Diff Forge audio push-to-talk shortcut: {error}");
    }
}

fn insert_text_with_enigo(text: &str) -> Result<(), String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");

    if normalized.is_empty() {
        return Err("No text was produced for insertion.".to_string());
    }

    let settings = enigo::Settings::default();
    let mut enigo = enigo::Enigo::new(&settings)
        .map_err(|error| format!("Unable to open native text output: {error}"))?;

    enigo::Keyboard::text(&mut enigo, &normalized)
        .map_err(|error| format!("Unable to insert transcript into the focused target: {error}"))
}

#[tauri::command]
async fn insert_handsfree_transcribed_text(
    app: AppHandle,
    text: String,
) -> Result<AudioWidgetVisibility, String> {
    let text = clean_transcript_for_insert(text)?;
    let widget_visible = app
        .get_webview_window(AUDIO_WIDGET_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    let insert_result = tauri::async_runtime::spawn_blocking(move || {
        thread::sleep(Duration::from_millis(AUDIO_HANDSFREE_INSERT_DELAY_MS));
        insert_text_with_enigo(&text)
    })
    .await
    .map_err(|error| format!("Unable to insert transcript: {error}"))?;

    if let Err(error) = insert_result {
        return Err(error);
    }

    Ok(AudioWidgetVisibility {
        visible: widget_visible,
        installed: whisper_model_status_for(&app)?.installed,
        shortcut: AUDIO_SHORTCUT,
    })
}
