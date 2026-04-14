use axum::response::sse::Event;
use futures::{Stream, StreamExt, TryStreamExt, stream};
use serde::Serialize;
use serde_json::Value;

use crate::types::claude::{ContentBlockDelta, CreateMessageResponse, StreamEvent, Usage};

/// Represents the data structure for streaming events in OpenAI API format
/// Contains a choices array with deltas of content
#[derive(Debug, Serialize)]
struct StreamEventData {
    choices: Vec<StreamEventDelta>,
}

impl StreamEventData {
    /// Creates a new StreamEventData with the given content
    ///
    /// # Arguments
    /// * `content` - The event content to include
    ///
    /// # Returns
    /// A new StreamEventData instance with the content wrapped in choices array
    fn new(content: EventContent) -> Self {
        Self {
            choices: vec![StreamEventDelta { delta: content }],
        }
    }
}

/// Represents a delta update in a streaming response
/// Contains the content change for the current chunk
#[derive(Debug, Serialize)]
struct StreamEventDelta {
    delta: EventContent,
}

/// Content of an event, either regular content or reasoning (thinking mode)
/// Uses untagged enum to handle different response formats
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum EventContent {
    Content { content: String },
    Reasoning { reasoning_content: String },
}

/// Creates an SSE event with the given content in OpenAI format
///
/// # Arguments
/// * `content` - The event content to include
///
/// # Returns
/// A formatted SSE Event ready to be sent to the client
pub fn build_event(content: EventContent) -> Event {
    let event = Event::default();
    let data = StreamEventData::new(content);
    event.json_data(data).unwrap()
}

/// Transforms a Claude.ai event stream into an OpenAI-compatible event stream
///
/// Extracts content from Claude events and reformats them to match OpenAI's streaming format.
/// Appends a final chunk with usage stats (including cache info) before [DONE].
pub fn transform_stream<I, E>(s: I, usage: Usage) -> impl Stream<Item = Result<Event, E>>
where
    I: Stream<Item = Result<eventsource_stream::Event, E>>,
    E: 'static,
{
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    let output_counter = Arc::new(AtomicU32::new(0));
    let counter_clone = output_counter.clone();

    let content_stream = s.try_filter_map(move |eventsource_stream::Event { data, .. }| {
        let counter = counter_clone.clone();
        async move {
            let Ok(parsed) = serde_json::from_str::<StreamEvent>(&data) else {
                return Ok(None);
            };
            let StreamEvent::ContentBlockDelta { delta, .. } = parsed else {
                return Ok(None);
            };
            match delta {
                ContentBlockDelta::TextDelta { text } => {
                    // Rough token estimate: ~4 chars per token
                    counter.fetch_add((text.len() as u32 + 3) / 4, Ordering::Relaxed);
                    Ok(Some(build_event(EventContent::Content { content: text })))
                }
                ContentBlockDelta::ThinkingDelta { thinking } => {
                    Ok(Some(build_event(EventContent::Reasoning {
                        reasoning_content: thinking,
                    })))
                }
                _ => Ok(None),
            }
        }
    });

    // Append a final usage event after the stream ends
    let usage_stream = stream::once(async move {
        let output_tokens = output_counter.load(Ordering::Relaxed);
        let prompt_tokens = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
        let mut usage_json = serde_json::json!({
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": output_tokens,
                "total_tokens": prompt_tokens + output_tokens,
                "prompt_tokens_details": {
                    "cached_tokens": usage.cache_read_input_tokens
                }
            }
        });
        if usage.cache_creation_input_tokens > 0 {
            usage_json["usage"]["cache_creation_input_tokens"] = serde_json::json!(usage.cache_creation_input_tokens);
        }
        if usage.cache_read_input_tokens > 0 {
            usage_json["usage"]["cache_read_input_tokens"] = serde_json::json!(usage.cache_read_input_tokens);
        }
        let event = Event::default().json_data(usage_json).unwrap();
        Ok(event)
    });

    content_stream.chain(usage_stream)
}

pub fn transforms_json(input: CreateMessageResponse) -> Value {
    // Extract text content
    let content = input
        .content
        .iter()
        .filter_map(|block| match block {
            crate::types::claude::ContentBlock::Text { text, .. } => Some(text.clone()),
            _ => None,
        })
        .collect::<String>();

    // Extract tool_calls (from tool_use blocks)
    let tool_calls: Vec<Value> = input
        .content
        .iter()
        .filter_map(|block| match block {
            crate::types::claude::ContentBlock::ToolUse { id, name, input, .. } => {
                Some(serde_json::json!({
                    "id": id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": serde_json::to_string(input).unwrap_or_default()
                    }
                }))
            }
            _ => None,
        })
        .collect();

    let mut message = serde_json::json!({
        "role": "assistant",
        "content": if content.is_empty() { Value::Null } else { Value::String(content) }
    });
    if !tool_calls.is_empty() {
        message["tool_calls"] = Value::Array(tool_calls);
    }

    let usage = input.usage.as_ref().map(|u| {
        let mut usage_json = serde_json::json!({
            "prompt_tokens": u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
            "completion_tokens": u.output_tokens,
            "total_tokens": u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens + u.output_tokens,
            "prompt_tokens_details": {
                "cached_tokens": u.cache_read_input_tokens
            }
        });
        // Also include Anthropic-native cache fields for clients that expect them
        if u.cache_creation_input_tokens > 0 {
            usage_json["cache_creation_input_tokens"] = serde_json::json!(u.cache_creation_input_tokens);
        }
        if u.cache_read_input_tokens > 0 {
            usage_json["cache_read_input_tokens"] = serde_json::json!(u.cache_read_input_tokens);
        }
        usage_json
    });

    let finish_reason = match input.stop_reason {
        Some(crate::types::claude::StopReason::EndTurn) => "stop",
        Some(crate::types::claude::StopReason::MaxTokens) => "length",
        Some(crate::types::claude::StopReason::StopSequence) => "stop",
        Some(crate::types::claude::StopReason::ToolUse) => "tool_calls",
        Some(crate::types::claude::StopReason::PauseTurn) => "stop",
        Some(crate::types::claude::StopReason::Refusal) => "content_filter",
        Some(crate::types::claude::StopReason::ModelContextWindowExceeded) => "length",
        None => "stop",
    };

    serde_json::json!({
        "id": input.id,
        "object": "chat.completion",
        "created": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        "model": input.model,
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": finish_reason
        }],
        "usage": usage
    })
}
