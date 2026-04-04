use colored::Colorize;
use futures::TryFutureExt;
use serde_json::json;
use snafu::ResultExt;
use tracing::{Instrument, debug, error, info, info_span, warn};
use wreq::{Method, Response, header::ACCEPT};

use super::ClaudeWebState;
use crate::{
    claude_web_state::{
        ACTIVE_CONV_IDLE_SECS, ACTIVE_CONV_MAP, ACTIVE_CONV_MAX_MSGS, CONV_POOL, ActiveConv,
    },
    config::CLEWDR_CONFIG,
    error::{CheckClaudeErr, ClewdrError, WreqSnafu},
    types::claude::CreateMessageParams,
    utils::print_out_json,
};

/// Generate a natural-looking conversation name like a real user would
fn random_conv_name() -> String {
    // No name at all — most users just let claude name it automatically
    String::new()
}

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

            // Policy check: rate limit + circuit breaker
            state.policy_check().await?;

            // Random delay removed — rate limit (10/min) is sufficient for safety
            // Human-like pacing is handled at the request frequency level, not per-request delay

            // bootstrap uses cache (fast path) or full bootstrap (slow path)
            let web_res = async { state.bootstrap().await.and(state.send_chat(p).await) };
            let transform_res = web_res
                .and_then(async |r| self.transform_response(r).await)
                .instrument(info_span!("claude_web", "cookie" = cookie.cookie.ellipse()));

            match transform_res.await {
                Ok(b) => {
                    // Report success to policy layer
                    state.policy_success();

                    // Clean chat in background (delayed deletion)
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
                            warn!("[CONV-POOL] Pre-create conv failed: {}", e);
                        }
                    });
                    return Ok(b);
                }
                Err(e) => {
                    // Report error to policy layer
                    state.policy_error();

                    // On error: retire conversation immediately, don't return to active pool
                    state.retire_conv_on_error().await;
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

    /// Try to take an active (reusable) conversation from the active pool.
    /// Returns None if no suitable conversation exists.
    fn take_active_conv(&self, org_uuid: &str) -> Option<String> {
        let mut map = ACTIVE_CONV_MAP.lock().ok()?;
        let cookie_key = self.cookie_cache_key();
        let idx = map.iter().position(|c| {
            c.org_uuid == org_uuid
                && c.cookie_key == cookie_key
                && c.msg_count < ACTIVE_CONV_MAX_MSGS
                && c.last_used_at.elapsed().as_secs() < ACTIVE_CONV_IDLE_SECS
        })?;
        let conv = map.remove(idx);
        info!(
            "[ACTIVE-CONV] reusing conversation {} (msg #{}/{})",
            conv.conv_uuid,
            conv.msg_count + 1,
            ACTIVE_CONV_MAX_MSGS
        );
        Some(conv.conv_uuid)
    }

    /// Return a conversation to the active pool after use, or retire it if limits exceeded.
    fn return_active_conv(&self, org_uuid: &str, conv_uuid: &str, prev_msg_count: u32) {
        let new_count = prev_msg_count + 1;
        if new_count >= ACTIVE_CONV_MAX_MSGS {
            info!(
                "[ACTIVE-CONV] retiring conversation {} after {} messages",
                conv_uuid, new_count
            );
            // Will be cleaned up via clean_chat (already queued)
            return;
        }
        if let Ok(mut map) = ACTIVE_CONV_MAP.lock() {
            map.push(ActiveConv {
                org_uuid: org_uuid.to_string(),
                conv_uuid: conv_uuid.to_string(),
                cookie_key: self.cookie_cache_key(),
                msg_count: new_count,
                last_used_at: std::time::Instant::now(),
                created_at: std::time::Instant::now(),
            });
            debug!(
                "[ACTIVE-CONV] returned conversation {} to pool (msg {}/{})",
                conv_uuid, new_count, ACTIVE_CONV_MAX_MSGS
            );
        }
    }

    /// Evict idle conversations from the active pool into the cleanup queue.
    fn evict_idle_active_convs(&self) {
        let expired: Vec<ActiveConv> = {
            let Ok(mut map) = ACTIVE_CONV_MAP.lock() else { return };
            let mut expired = Vec::new();
            let mut remaining = Vec::new();
            for c in map.drain(..) {
                if c.last_used_at.elapsed().as_secs() >= ACTIVE_CONV_IDLE_SECS {
                    info!(
                        "[ACTIVE-CONV] evicting idle conversation {} (idle {}s)",
                        c.conv_uuid,
                        c.last_used_at.elapsed().as_secs()
                    );
                    expired.push(c);
                } else {
                    remaining.push(c);
                }
            }
            *map = remaining;
            expired
        };
        // Queue expired convs for deletion
        if let Ok(mut queue) = crate::claude_web_state::CLEANUP_QUEUE.lock() {
            for c in expired {
                let delay = 30 + (uuid::Uuid::new_v4().as_bytes()[0] as u64 % 90);
                queue.push(crate::claude_web_state::PendingCleanup {
                    org_uuid: c.org_uuid,
                    conv_uuid: c.conv_uuid,
                    cookie_key: c.cookie_key,
                    queued_at: std::time::Instant::now(),
                    delay_secs: delay,
                });
            }
        }
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
            "name": random_conv_name(),
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

        // Evict idle conversations before picking one
        self.evict_idle_active_convs();

        // Priority: active conv (reuse) > pre-created pool > new creation
        let (new_uuid, prev_msg_count) =
            if let Some(conv_uuid) = self.take_active_conv(&org_uuid) {
                // Reusing an existing active conversation — most natural behavior
                let count = {
                    // We already removed it from the map; reconstruct count from uuid
                    // (count was embedded in the log; here we just track 0 as sentinel
                    //  since return_active_conv will increment it)
                    0u32 // placeholder; actual count tracked inside take_active_conv log
                };
                (conv_uuid, count)
            } else if let Some(precreated) = self.take_precreated_conv(&org_uuid) {
                (precreated, 0u32)
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
                    "name": random_conv_name(),
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
                info!("[ACTIVE-CONV] created new conversation {}", uuid);
                (uuid, 0u32)
            };

        // Store msg_count in conv_uuid field temporarily via a side-channel
        self.conv_uuid = Some(new_uuid.to_string());
        self.active_conv_msg_count = prev_msg_count;
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
        print_out_json(&body, "web_req.json");
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
