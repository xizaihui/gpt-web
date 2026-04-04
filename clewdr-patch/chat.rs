use colored::Colorize;
use futures::TryFutureExt;
use serde_json::json;
use snafu::ResultExt;
use tracing::{Instrument, debug, error, info, info_span, warn};
use wreq::{Method, Response, header::ACCEPT};

use super::ClaudeWebState;
use crate::{
    claude_web_state::CONV_POOL,
    config::CLEWDR_CONFIG,
    error::{CheckClaudeErr, ClewdrError, WreqSnafu},
    types::claude::CreateMessageParams,
    utils::print_out_json,
};

impl ClaudeWebState {
    /// Attempts to send a chat message to Claude API with retry mechanism
    pub async fn try_chat(
        &mut self,
        p: CreateMessageParams,
    ) -> Result<axum::response::Response, ClewdrError> {
        for i in 0..CLEWDR_CONFIG.load().max_retries + 1 {
            if i > 0 {
                info!("[RETRY] attempt: {}", i.to_string().green());
            }
            let mut state = self.to_owned();
            let p = p.to_owned();

            let cookie = state.request_cookie().await?;
            // bootstrap uses cache (fast path) or full bootstrap (slow path)
            let web_res = async { state.bootstrap().await.and(state.send_chat(p).await) };
            let transform_res = web_res
                .and_then(async |r| self.transform_response(r).await)
                .instrument(info_span!("claude_web", "cookie" = cookie.cookie.ellipse()));

            match transform_res.await {
                Ok(b) => {
                    // Clean chat in background, don't block response
                    let clean_state = state.clone();
                    tokio::spawn(async move {
                        if let Err(e) = clean_state.clean_chat().await {
                            warn!("Failed to clean chat: {}", e);
                        }
                    });
                    // Pre-create next conversation in background for next request
                    let precreate_state = state.clone();
                    tokio::spawn(async move {
                        if let Err(e) = precreate_state.precreate_conversation().await {
                            debug!("Pre-create conv failed (non-critical): {}", e);
                        }
                    });
                    return Ok(b);
                }
                Err(e) => {
                    if let Err(e) = state.clean_chat().await {
                        warn!("Failed to clean chat: {}", e);
                    }
                    error!("{e}");
                    if let ClewdrError::InvalidCookie { reason } = e {
                        state.return_cookie(Some(reason.to_owned())).await;
                        continue;
                    }
                    return Err(e);
                }
            }
        }
        error!("Max retries exceeded");
        Err(ClewdrError::TooManyRetries)
    }

    /// Try to take a pre-created conversation from the pool
    fn take_precreated_conv(&self, org_uuid: &str) -> Option<String> {
        let mut pool = CONV_POOL.lock().ok()?;
        let cookie_key = self.cookie_cache_key();
        // Find a matching conv that's less than 4 minutes old
        let idx = pool.iter().position(|c| {
            c.org_uuid == org_uuid
                && c.cookie_key == cookie_key
                && c.created_at.elapsed().as_secs() < 240
        })?;
        let conv = pool.remove(idx);
        info!(
            "[CONV-POOL] reusing pre-created conversation: {}",
            conv.conv_uuid
        );
        Some(conv.conv_uuid)
    }

    /// Pre-create a conversation and store it in the pool for the next request
    pub async fn precreate_conversation(&self) -> Result<(), ClewdrError> {
        let org_uuid = self
            .org_uuid
            .as_ref()
            .ok_or(ClewdrError::UnexpectedNone {
                msg: "No org_uuid for pre-creation",
            })?;

        // Don't overfill the pool
        {
            let pool = CONV_POOL.lock().map_err(|_| ClewdrError::UnexpectedNone {
                msg: "Pool lock poisoned",
            })?;
            let cookie_key = self.cookie_cache_key();
            let existing = pool
                .iter()
                .filter(|c| c.cookie_key == cookie_key)
                .count();
            if existing >= 2 {
                return Ok(());
            }
        }

        let new_uuid = uuid::Uuid::new_v4().to_string();
        let endpoint = self
            .endpoint
            .join(&format!(
                "api/organizations/{}/chat_conversations",
                org_uuid
            ))
            .expect("Url parse error");
        let body = json!({
            "uuid": new_uuid,
            "name": format!("ClewdR-{}", chrono::Utc::now().format("%Y-%m-%d %H:%M:%S")),
        });

        self.build_request(Method::POST, endpoint)
            .json(&body)
            .send()
            .await
            .context(WreqSnafu {
                msg: "Failed to pre-create conversation",
            })?
            .check_claude()
            .await?;

        info!("[CONV-POOL] pre-created conversation: {}", new_uuid);

        let mut pool = CONV_POOL.lock().map_err(|_| ClewdrError::UnexpectedNone {
            msg: "Pool lock poisoned",
        })?;
        pool.push(super::PreCreatedConv {
            org_uuid: org_uuid.clone(),
            conv_uuid: new_uuid,
            cookie_key: self.cookie_cache_key(),
            created_at: std::time::Instant::now(),
        });

        Ok(())
    }

    /// Sends a message to the Claude API
    async fn send_chat(&mut self, p: CreateMessageParams) -> Result<Response, ClewdrError> {
        let org_uuid = self
            .org_uuid
            .to_owned()
            .ok_or(ClewdrError::UnexpectedNone {
                msg: "Organization UUID is not set",
            })?;

        // Try to use a pre-created conversation first
        let new_uuid = if let Some(precreated) = self.take_precreated_conv(&org_uuid) {
            precreated
        } else {
            // Create a new conversation (original path)
            let uuid = uuid::Uuid::new_v4().to_string();
            let endpoint = self
                .endpoint
                .join(&format!(
                    "api/organizations/{}/chat_conversations",
                    org_uuid
                ))
                .expect("Url parse error");
            let body = json!({
                "uuid": uuid,
                "name": format!("ClewdR-{}", chrono::Utc::now().format("%Y-%m-%d %H:%M:%S")),
            });

            self.build_request(Method::POST, endpoint)
                .json(&body)
                .send()
                .await
                .context(WreqSnafu {
                    msg: "Failed to create new conversation",
                })?
                .check_claude()
                .await?;
            uuid
        };

        self.conv_uuid = Some(new_uuid.to_string());
        debug!("Using conversation: {}", new_uuid);

        // preserve original params for possible post-call token accounting
        self.last_params = Some(p.clone());
        let mut body = json!({});
        // enable thinking mode
        body["settings"]["paprika_mode"] = if p.thinking.is_some() && self.is_pro() {
            "extended".into()
        } else {
            json!(null)
        };

        let endpoint = self
            .endpoint
            .join(&format!(
                "api/organizations/{}/chat_conversations/{}",
                org_uuid, new_uuid
            ))
            .expect("Url parse error");
        let _ = self
            .build_request(Method::PUT, endpoint)
            .json(&body)
            .send()
            .await;
        // generate the request body
        let mut body = self.transform_request(p).ok_or(ClewdrError::BadRequest {
            msg: "Request body is empty",
        })?;

        // check images
        let images = body.images.drain(..).collect::<Vec<_>>();

        // upload images
        let files = self.upload_images(images).await;
        body.files = files;

        // send the request
        print_out_json(&body, "claude_web_clewdr_req.json");
        let endpoint = self
            .endpoint
            .join(&format!(
                "api/organizations/{}/chat_conversations/{}/completion",
                org_uuid, new_uuid
            ))
            .expect("Url parse error");

        self.build_request(Method::POST, endpoint)
            .json(&body)
            .header(ACCEPT, "text/event-stream")
            .send()
            .await
            .context(WreqSnafu {
                msg: "Failed to send chat request",
            })?
            .check_claude()
            .await
    }
}
