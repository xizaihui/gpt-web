use axum::{
    Json,
    body::{self, Body},
    response::{IntoResponse, Response, Sse},
};
use eventsource_stream::Eventsource;
use futures::TryStreamExt;
use http::header::CONTENT_TYPE;
use tracing::warn;

use super::{ClaudeApiFormat, transform_stream};
use crate::{
    middleware::claude::{ClaudeContext, transforms_json, tool_sim},
    types::claude::{CreateMessageResponse, StreamEvent, ContentBlock, StopReason},
};

async fn parse_response<T>(resp: Response) -> Result<T, Response>
where
    T: serde::de::DeserializeOwned,
{
    let body = body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .inspect_err(|err| {
            warn!("Failed to read response body: {}", err);
        })
        .unwrap_or_default();
    let Ok(parsed) = serde_json::from_slice::<T>(&body) else {
        return Err(Response::builder()
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap());
    };
    Ok(parsed)
}

/// Transforms responses to ensure compatibility with the OpenAI API format
///
/// This middleware function analyzes responses and transforms them when necessary
/// to ensure compatibility between Claude and OpenAI API formats, particularly
/// for streaming responses. If the response is:
///
/// - From the Claude API format: No transformation needed
/// - Not streaming: No transformation needed
/// - Has a non-200 status code: No transformation needed
/// - OpenAI format and streaming: Transforms the stream to match OpenAI event format
///
/// # Arguments
///
/// * `resp` - The original response to be potentially transformed
///
/// # Returns
///
/// The original or transformed response as appropriate
/// Post-process a CreateMessageResponse to extract tool_call XML from text
/// and convert to proper tool_use content blocks
fn postprocess_tool_calls(mut response: CreateMessageResponse) -> CreateMessageResponse {
    let mut new_content = Vec::new();
    let mut found_tool = false;

    for block in std::mem::take(&mut response.content) {
        match block {
            ContentBlock::Text { text, cache_control, citations } => {
                let (remaining_text, tool_calls) = tool_sim::parse_tool_calls_from_text(&text);
                if !tool_calls.is_empty() {
                    found_tool = true;
                    if !remaining_text.is_empty() {
                        new_content.push(ContentBlock::Text {
                            text: remaining_text,
                            cache_control,
                            citations,
                        });
                    }
                    new_content.extend(tool_calls);
                } else {
                    new_content.push(ContentBlock::Text { text, cache_control, citations });
                }
            }
            other => new_content.push(other),
        }
    }

    response.content = new_content;
    if found_tool {
        response.stop_reason = Some(StopReason::ToolUse);
    }
    response
}

pub async fn to_oai(resp: Response) -> impl IntoResponse {
    let Some(cx) = resp.extensions().get::<ClaudeContext>() else {
        return resp;
    };
    if ClaudeApiFormat::Claude == cx.api_format() {
        return resp;
    }
    if !cx.is_stream() {
        match parse_response::<CreateMessageResponse>(resp).await {
            Ok(response) => {
                let response = postprocess_tool_calls(response);
                return Json(transforms_json(response)).into_response();
            }
            Err(resp) => return resp,
        }
    }
    let usage = cx.usage().to_owned();
    let stream = resp.into_body().into_data_stream().eventsource();
    let stream = transform_stream(stream, usage);
    Sse::new(stream)
        .keep_alive(Default::default())
        .into_response()
}

pub async fn add_usage_info(resp: Response) -> impl IntoResponse {
    let Some(cx) = resp.extensions().get::<ClaudeContext>() else {
        return resp;
    };
    let (mut usage, stream) = (cx.usage().to_owned(), cx.is_stream());
    if !stream {
        let mut response = match parse_response::<CreateMessageResponse>(resp).await {
            Ok(response) => response,
            Err(resp) => return resp,
        };
        let response = postprocess_tool_calls(response);
        let mut response = response;
        let output_tokens = response.count_tokens();
        usage.output_tokens = output_tokens;
        response.usage = Some(usage);
        return Json(response).into_response();
    }
    let stream = resp
        .into_body()
        .into_data_stream()
        .eventsource()
        .map_ok(move |event| {
            let new_event = axum::response::sse::Event::default()
                .event(event.event)
                .id(event.id);
            let new_event = if let Some(retry) = event.retry {
                new_event.retry(retry)
            } else {
                new_event
            };
            let Ok(parsed) = serde_json::from_str::<StreamEvent>(&event.data) else {
                return new_event.data(event.data);
            };
            match parsed {
                StreamEvent::MessageStart { mut message } => {
                    message.usage.get_or_insert(usage.to_owned());
                    new_event
                        .json_data(StreamEvent::MessageStart { message })
                        .unwrap()
                }
                StreamEvent::MessageDelta { delta, usage } => {
                    let usage = usage.unwrap_or_default();
                    new_event
                        .json_data(StreamEvent::MessageDelta {
                            delta,
                            usage: Some(usage),
                        })
                        .unwrap()
                }
                _ => new_event.data(event.data),
            }
        });

    Sse::new(stream)
        .keep_alive(Default::default())
        .into_response()
}

pub async fn check_overloaded(mut resp: Response) -> Response {
    let Some(cx) = resp.extensions().get::<ClaudeContext>() else {
        return resp;
    };
    if !cx.is_stream() {
        return resp;
    }
    if resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| !v.contains("text/event-stream"))
    {
        resp.extensions_mut().remove::<ClaudeContext>();
    }
    resp
}
