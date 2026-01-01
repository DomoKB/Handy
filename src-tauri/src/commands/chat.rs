use crate::llm_client;
use crate::settings::{get_settings, AppSettings};
use async_openai::types::*;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use specta::Type;

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
pub struct ChatStats {
    pub tokens_per_second: f64,
    pub total_tokens: u32,
    pub completion_tokens: u32,
    pub prompt_tokens: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
pub struct ChatResponse {
    pub content: String,
    pub stats: Option<ChatStats>,
}

#[tauri::command]
#[specta::specta]
pub async fn send_chat_message(
    app: AppHandle,
    message: String,
    history: Vec<ChatMessage>,
) -> Result<ChatResponse, String> {
    let settings = get_settings(&app);

    // Get active provider
    let provider = settings
        .active_post_process_provider()
        .ok_or_else(|| "No post-processing provider selected".to_string())?
        .clone();

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .ok_or_else(|| format!("No model configured for provider {}", provider.id))?;

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    // Create client
    let client = llm_client::create_client(&provider, api_key)
        .map_err(|e| format!("Failed to create client: {}", e))?;

    // Build messages
    let mut messages: Vec<ChatCompletionRequestMessage> = Vec::new();

    // Add history
    for msg in history {
        if msg.role == "user" {
            let user_msg = ChatCompletionRequestUserMessageArgs::default()
                .content(msg.content)
                .build()
                .map_err(|e| e.to_string())?;
            messages.push(ChatCompletionRequestMessage::User(user_msg));
        } else if msg.role == "assistant" {
            let assistant_msg = ChatCompletionRequestAssistantMessageArgs::default()
                .content(msg.content)
                .build()
                .map_err(|e| e.to_string())?;
            messages.push(ChatCompletionRequestMessage::Assistant(assistant_msg));
        }
    }

    // Add current message
    let current_msg = ChatCompletionRequestUserMessageArgs::default()
        .content(message)
        .build()
        .map_err(|e| e.to_string())?;
    messages.push(ChatCompletionRequestMessage::User(current_msg));

    let request = CreateChatCompletionRequestArgs::default()
        .model(model)
        .messages(messages)
        .build()
        .map_err(|e| format!("Failed to build request: {}", e))?;

    let start_time = std::time::Instant::now();

    let response = client
        .chat()
        .create(request)
        .await
        .map_err(|e| format!("Chat request failed: {}", e))?;

    let duration = start_time.elapsed();

    let content = response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| "No content in response".to_string())?;

    let stats = if let Some(usage) = response.usage {
        let tps = if usage.completion_tokens > 0 {
            usage.completion_tokens as f64 / duration.as_secs_f64()
        } else {
            0.0
        };

        Some(ChatStats {
            tokens_per_second: tps,
            total_tokens: usage.total_tokens,
            completion_tokens: usage.completion_tokens,
            prompt_tokens: usage.prompt_tokens,
        })
    } else {
        None
    };

    Ok(ChatResponse { content, stats })
}
