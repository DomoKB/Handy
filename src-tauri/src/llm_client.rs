use crate::settings::PostProcessProvider;
use async_openai::types::*;
use async_openai::{config::OpenAIConfig, Client};

/// Create an OpenAI-compatible client configured for the given provider
pub fn create_client(
    provider: &PostProcessProvider,
    api_key: String,
) -> Result<Client<OpenAIConfig>, String> {
    let base_url = provider.base_url.trim_end_matches('/');
    let config = OpenAIConfig::new()
        .with_api_base(base_url)
        .with_api_key(api_key);

    // Create client with Anthropic-specific header if needed
    let client = if provider.id == "anthropic" {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "anthropic-version",
            reqwest::header::HeaderValue::from_static("2023-06-01"),
        );

        let http_client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        Client::with_config(config).with_http_client(http_client)
    } else {
        Client::with_config(config)
    };

    Ok(client)
}

use serde::Deserialize;

#[derive(Deserialize)]
struct LooseModelResponse {
    data: Vec<LooseModelItem>,
}

#[derive(Deserialize)]
struct LooseModelItem {
    id: String,
}

pub async fn fetch_models(
    provider: &PostProcessProvider,
    api_key: String,
) -> Result<Vec<String>, String> {
    // Strategy 1: Try standard strict client (async-openai)
    // This is preferred as it validates the response structure correctly against the OpenAI spec.
    println!("[LLM] Attempting strict fetch for {}", provider.label);
    let strict_result = async {
        let client = create_client(provider, api_key.clone())?;
        client.models().list().await.map_err(|e| format!("{}", e))
    }
    .await;

    match strict_result {
        Ok(models) => {
            println!(
                "[LLM SUCCESS] Strict fetch succeeded. Fetched {} models from {}",
                models.data.len(),
                provider.label
            );
            return Ok(models.data.into_iter().map(|m| m.id).collect());
        }
        Err(e) => {
            println!(
                "[LLM WARNING] Strict fetch failed for {}: {}. Attempting fallback...",
                provider.label, e
            );
        }
    }

    // Strategy 2: Fallback to loose manual request (reqwest)
    // This handles providers like Google that omit required fields (e.g. `created`).
    println!("[LLM] Attempting loose fallback for {}", provider.label);

    let client = reqwest::Client::new();
    let base_url = provider.base_url.trim_end_matches('/');
    // Handle different endpoint conventions if needed, but usually it's /models
    let url = if let Some(endpoint) = &provider.models_endpoint {
        // If a specific endpoint override is provided (future proofing)
        format!("{}{}", base_url, endpoint)
    } else {
        format!("{}/models", base_url)
    };

    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Failed to send fallback request: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Provider API returned error {}: {}", status, text));
    }

    let body = res
        .json::<LooseModelResponse>()
        .await
        .map_err(|e| format!("Failed to parse fallback API response: {}", e))?;

    println!(
        "[LLM SUCCESS] Fallback fetch succeeded. Fetched {} models from {}",
        body.data.len(),
        provider.label
    );
    Ok(body.data.into_iter().map(|m| m.id).collect())
}

pub async fn send_chat_completion(
    provider: &PostProcessProvider,
    api_key: String,
    model: &str,
    prompt: String,
) -> Result<Option<String>, String> {
    let client = create_client(provider, api_key)?;

    let request = CreateChatCompletionRequestArgs::default()
        .model(model)
        .messages([ChatCompletionRequestMessage::User(
            ChatCompletionRequestUserMessageArgs::default()
                .content(prompt)
                .build()
                .map_err(|e| format!("Failed to build user message: {}", e))?,
        )])
        .build()
        .map_err(|e| format!("Failed to build chat request: {}", e))?;

    let response = client
        .chat()
        .create(request)
        .await
        .map_err(|e| format!("Failed to send chat request: {}", e))?;

    Ok(response
        .choices
        .first()
        .and_then(|c| c.message.content.clone()))
}
