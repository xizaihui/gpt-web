use std::sync::LazyLock;
use std::time::Duration;

use axum::http::{
    HeaderValue,
    header::COOKIE,
};
use moka::sync::Cache;
use snafu::ResultExt;
use tracing::{debug, error, info, warn};
use url::Url;
use wreq::{
    Client, Method, Proxy, RequestBuilder,
    header::{ORIGIN, REFERER},
};
use wreq_util::Emulation;

use crate::{
    config::{CLAUDE_ENDPOINT, CLEWDR_CONFIG, CookieStatus, Reason},
    error::{ClewdrError, WreqSnafu},
    middleware::claude::ClaudeApiFormat,
    services::cookie_actor::CookieActorHandle,
    types::claude::{CreateMessageParams, Usage},
};

// ── Bootstrap cache: avoid re-bootstrapping the same cookie within 5 minutes ──
#[derive(Clone, Debug)]
pub struct BootstrapCacheEntry {
    pub org_uuid: String,
    pub capabilities: Vec<String>,
}

pub static BOOTSTRAP_CACHE: LazyLock<Cache<String, BootstrapCacheEntry>> = LazyLock::new(|| {
    Cache::builder()
        .time_to_live(Duration::from_secs(300)) // 5 minutes
        .max_capacity(100)
        .build()
});

// ── Prompt prefix cache (simulates Anthropic cache_control behavior) ──
// Key: hash of cached blocks content, Value: token count of cached portion
pub static PROMPT_CACHE: LazyLock<Cache<u64, u32>> = LazyLock::new(|| {
    Cache::builder()
        .time_to_live(Duration::from_secs(120)) // 2 min TTL, ~50% hit rate
        .max_capacity(1000)
        .build()
});

// ── Pre-created conversation pool ──
#[derive(Clone, Debug)]
pub struct PreCreatedConv {
    pub org_uuid: String,
    pub conv_uuid: String,
    pub cookie_key: String,
    pub created_at: std::time::Instant,
}

// ── Active conversation pool: reuse conversations across requests (like real users) ──
pub const ACTIVE_CONV_MAX_MSGS: u32 = 20;       // retire after 20 messages
pub const ACTIVE_CONV_IDLE_SECS: u64 = 1800;    // retire after 30 min idle

#[derive(Clone, Debug)]
pub struct ActiveConv {
    pub org_uuid: String,
    pub conv_uuid: String,
    pub pool_key: String,   // composite: cookie_key:session_id
    pub msg_count: u32,
    pub cumulative_tokens: u32, // total tokens in this conversation window (for cache stats)
    pub last_used_at: std::time::Instant,
    pub created_at: std::time::Instant,
}

pub static ACTIVE_CONV_MAP: LazyLock<std::sync::Mutex<Vec<ActiveConv>>> =
    LazyLock::new(|| std::sync::Mutex::new(Vec::new()));

// ── Delayed cleanup queue: delete conversations after a random delay ──
#[derive(Clone, Debug)]
pub struct PendingCleanup {
    pub org_uuid: String,
    pub conv_uuid: String,
    pub cookie_key: String,
    pub queued_at: std::time::Instant,
    pub delay_secs: u64, // random delay before deletion
}

pub static CLEANUP_QUEUE: LazyLock<std::sync::Mutex<Vec<PendingCleanup>>> =
    LazyLock::new(|| std::sync::Mutex::new(Vec::new()));

pub static CONV_POOL: LazyLock<std::sync::Mutex<Vec<PreCreatedConv>>> =
    LazyLock::new(|| std::sync::Mutex::new(Vec::new()));

// ── Policy Layer: rate limiting + circuit breaker per cookie ──
#[derive(Clone, Debug)]
pub struct CookiePolicy {
    /// Timestamps of recent requests (for rate limiting)
    pub request_times: Vec<std::time::Instant>,
    /// Consecutive error count (for circuit breaker)
    pub consecutive_errors: u32,
    /// If set, cookie is frozen until this time
    pub frozen_until: Option<std::time::Instant>,
}

impl Default for CookiePolicy {
    fn default() -> Self {
        Self {
            request_times: Vec::new(),
            consecutive_errors: 0,
            frozen_until: None,
        }
    }
}

pub static COOKIE_POLICIES: LazyLock<std::sync::Mutex<std::collections::HashMap<String, CookiePolicy>>> =
    LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

pub mod bootstrap;
pub mod chat;
mod transform;
/// Placeholder
pub static SUPER_CLIENT: LazyLock<Client> = LazyLock::new(Client::new);

/// State of current connection
#[derive(Clone)]
pub struct ClaudeWebState {
    pub cookie: Option<CookieStatus>,
    cookie_header_value: HeaderValue,
    pub cookie_actor_handle: CookieActorHandle,
    pub org_uuid: Option<String>,
    pub conv_uuid: Option<String>,
    pub capabilities: Vec<String>,
    pub endpoint: Url,
    pub proxy: Option<Proxy>,
    pub api_format: ClaudeApiFormat,
    pub stream: bool,
    pub client: Client,
    pub key: Option<(u64, usize)>,
    pub usage: Usage,
    pub last_params: Option<CreateMessageParams>,
    pub active_conv_msg_count: u32,
    /// Session ID from X-Session-Id header
    pub session_id: Option<String>,
    /// Whether this request is reusing an existing active conversation
    pub is_reusing_conv: bool,
    /// Cumulative tokens in the reused conversation (for cache_read estimation)
    pub reused_conv_tokens: u32,
}

impl ClaudeWebState {
    /// Create a new AppState instance
    pub fn new(cookie_actor_handle: CookieActorHandle) -> Self {
        ClaudeWebState {
            cookie_actor_handle,
            cookie: None,
            org_uuid: None,
            conv_uuid: None,
            cookie_header_value: HeaderValue::from_static(""),
            capabilities: Vec::new(),
            endpoint: CLEWDR_CONFIG.load().endpoint(),
            proxy: CLEWDR_CONFIG.load().wreq_proxy.to_owned(),
            api_format: ClaudeApiFormat::Claude,
            stream: false,
            client: SUPER_CLIENT.to_owned(),
            key: None,
            usage: Usage::default(),
            last_params: None,
            active_conv_msg_count: 0,
            session_id: None,
            is_reusing_conv: false,
            reused_conv_tokens: 0,
        }
    }

    pub fn with_claude_format(mut self) -> Self {
        self.api_format = ClaudeApiFormat::Claude;
        self
    }

    pub fn with_openai_format(mut self) -> Self {
        self.api_format = ClaudeApiFormat::OpenAI;
        self
    }

    /// Returns a cache key derived from the current cookie
    pub fn cookie_cache_key(&self) -> String {
        self.cookie
            .as_ref()
            .map(|c| c.cookie.to_string())
            .unwrap_or_default()
    }

    /// Returns a composite key for the active conversation pool.
    /// Combines cookie key + session_id so each user gets their own conversation.
    pub fn conv_pool_key(&self) -> String {
        let cookie = self.cookie_cache_key();
        match &self.session_id {
            Some(sid) if !sid.is_empty() => format!("{}:{}", cookie, sid),
            _ => cookie,
        }
    }

    /// Build a request with the current cookie, proxy settings, and browser-like headers
    pub fn build_request(&self, method: Method, url: impl ToString) -> RequestBuilder {
        let mut req = self
            .client
            .request(method, url.to_string())
            .header(ORIGIN, CLAUDE_ENDPOINT)
            // Browser-like headers to reduce fingerprinting
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Sec-CH-UA", "\"Chromium\";v=\"136\", \"Google Chrome\";v=\"136\", \"Not.A/Brand\";v=\"8\"")
            .header("Sec-CH-UA-Mobile", "?0")
            .header("Sec-CH-UA-Platform", "\"Windows\"")
            .header("Sec-Fetch-Dest", "empty")
            .header("Sec-Fetch-Mode", "cors")
            .header("Sec-Fetch-Site", "same-origin");
        if !self.cookie_header_value.as_bytes().is_empty() {
            req = req.header(COOKIE, self.cookie_header_value.clone());
        }
        if let Some(uuid) = self.conv_uuid.to_owned() {
            req.header(
                REFERER,
                self.endpoint
                    .join(&format!("chat/{uuid}"))
                    .map(|u| u.into())
                    .unwrap_or_else(|_| format!("{CLAUDE_ENDPOINT}chat/{uuid}")),
            )
        } else {
            req.header(
                REFERER,
                self.endpoint
                    .join("new")
                    .map(|u| u.into())
                    .unwrap_or_else(|_| format!("{CLAUDE_ENDPOINT}new")),
            )
        }
    }

    /// Checks if the current user has pro capabilities
    /// Returns true if any capability contains "pro", "enterprise", "raven", or "max"
    pub fn is_pro(&self) -> bool {
        self.capabilities.iter().any(|c| {
            c.contains("pro")
                || c.contains("enterprise")
                || c.contains("raven")
                || c.contains("max")
        })
    }

    /// Requests a new cookie from the cookie manager
    /// Updates the internal state with the new cookie and proxy configuration
    pub async fn request_cookie(&mut self) -> Result<CookieStatus, ClewdrError> {
        let res = self.cookie_actor_handle.request(None).await?;
        self.cookie = Some(res.to_owned());
        self.endpoint = CLEWDR_CONFIG.load().endpoint();

        // Per-cookie proxy takes priority over global proxy
        let effective_proxy = if let Some(ref cookie_proxy) = res.proxy {
            // This cookie has its own proxy configured
            match Proxy::all(cookie_proxy) {
                Ok(p) => {
                    info!(
                        "[PROXY] Using per-cookie proxy for {}…",
                        &res.cookie.ellipse()
                    );
                    Some(p)
                }
                Err(e) => {
                    warn!(
                        "[PROXY] Failed to parse per-cookie proxy '{}': {}, falling back to global",
                        cookie_proxy, e
                    );
                    CLEWDR_CONFIG.load().wreq_proxy.to_owned()
                }
            }
        } else {
            // No per-cookie proxy, use global
            CLEWDR_CONFIG.load().wreq_proxy.to_owned()
        };

        self.proxy = effective_proxy.clone();
        let mut client = Client::builder()
            .cookie_store(true)
            .emulation(Emulation::Chrome136);
        if let Some(ref proxy) = effective_proxy {
            client = client.proxy(proxy.to_owned());
        }
        self.client = client.build().context(WreqSnafu {
            msg: "Failed to build client with new cookie",
        })?;
        self.cookie_header_value = HeaderValue::from_str(res.cookie.to_string().as_str())?;
        Ok(res)
    }

    /// Returns the current cookie to the cookie manager
    /// Optionally provides a reason for returning the cookie (e.g., invalid, banned)
    pub async fn return_cookie(&self, reason: Option<Reason>) {
        // return the cookie to the cookie manager
        if let Some(ref cookie) = self.cookie {
            self.cookie_actor_handle
                .return_cookie(cookie.to_owned(), reason)
                .await
                .unwrap_or_else(|e| {
                    error!("Failed to send cookie: {}", e);
                });
        }
    }

    fn classify_model(model: &str) -> crate::config::ModelFamily {
        let m = model.to_ascii_lowercase();
        if m.contains("opus") {
            crate::config::ModelFamily::Opus
        } else if m.contains("sonnet") {
            crate::config::ModelFamily::Sonnet
        } else {
            crate::config::ModelFamily::Other
        }
    }

    pub async fn persist_usage_totals(&mut self, input: u64, output: u64) {
        if input == 0 && output == 0 {
            return;
        }
        if let Some(cookie) = self.cookie.as_mut() {
            let family = self
                .last_params
                .as_ref()
                .map(|p| Self::classify_model(&p.model))
                .unwrap_or(crate::config::ModelFamily::Other);
            cookie.add_and_bucket_usage(input, output, family);
            let cloned = cookie.clone();
            if let Err(err) = self.cookie_actor_handle.return_cookie(cloned, None).await {
                warn!("Failed to persist usage statistics: {}", err);
            }
        }
    }

    // ── Policy Layer methods ──

    /// Check if this cookie is allowed to make a request (rate limit + circuit breaker)
    /// If rate limited, waits until the next slot is available instead of rejecting.
    pub async fn policy_check(&self) -> Result<(), ClewdrError> {
        let cookie_key = self.cookie_cache_key();
        if cookie_key.is_empty() {
            return Ok(());
        }

        // Circuit breaker check
        {
            let mut policies = COOKIE_POLICIES.lock().map_err(|_| ClewdrError::UnexpectedNone {
                msg: "Policy lock poisoned",
            })?;
            let policy = policies.entry(cookie_key.clone()).or_default();

            if let Some(frozen_until) = policy.frozen_until {
                if std::time::Instant::now() < frozen_until {
                    let remaining = frozen_until.duration_since(std::time::Instant::now()).as_secs();
                    warn!("[POLICY] Cookie frozen, {}s remaining", remaining);
                    return Err(ClewdrError::BadRequest {
                        msg: "Account temporarily frozen due to consecutive errors",
                    });
                } else {
                    policy.frozen_until = None;
                    policy.consecutive_errors = 0;
                    info!("[POLICY] Cookie unfrozen, resuming");
                }
            }
        }

        // Rate limit: max 10 requests per minute per cookie
        // If over limit, WAIT until a slot opens up (don't reject)
        loop {
            let wait_duration = {
                let mut policies = COOKIE_POLICIES.lock().map_err(|_| ClewdrError::UnexpectedNone {
                    msg: "Policy lock poisoned",
                })?;
                let policy = policies.entry(cookie_key.clone()).or_default();

                let now = std::time::Instant::now();
                let one_min_ago = now - Duration::from_secs(60);
                policy.request_times.retain(|t| *t > one_min_ago);

                if policy.request_times.len() < 10 {
                    // Under limit — record and proceed
                    policy.request_times.push(now);
                    None
                } else {
                    // Over limit — calculate wait time
                    let oldest = policy.request_times[0];
                    let wait = Duration::from_secs(60).saturating_sub(now.duration_since(oldest));
                    info!("[POLICY] Rate limit hit ({}/min), waiting {}s",
                        policy.request_times.len(), wait.as_secs());
                    Some(wait + Duration::from_millis(100)) // small buffer
                }
            };

            match wait_duration {
                None => break Ok(()),
                Some(wait) => {
                    tokio::time::sleep(wait).await;
                }
            }
        }
    }

    /// Report a successful request — reset consecutive error count
    pub fn policy_success(&self) {
        let cookie_key = self.cookie_cache_key();
        if cookie_key.is_empty() {
            return;
        }
        if let Ok(mut policies) = COOKIE_POLICIES.lock() {
            if let Some(policy) = policies.get_mut(&cookie_key) {
                policy.consecutive_errors = 0;
            }
        }
    }

    /// Report a failed request — increment error count, potentially freeze
    pub fn policy_error(&self) {
        let cookie_key = self.cookie_cache_key();
        if cookie_key.is_empty() {
            return;
        }
        if let Ok(mut policies) = COOKIE_POLICIES.lock() {
            let policy = policies.entry(cookie_key).or_default();
            policy.consecutive_errors += 1;

            // Freeze after 3 consecutive errors
            if policy.consecutive_errors >= 3 {
                let freeze_duration = Duration::from_secs(30 * 60); // 30 minutes
                policy.frozen_until = Some(std::time::Instant::now() + freeze_duration);
                warn!(
                    "[POLICY] Cookie frozen for 30min after {} consecutive errors",
                    policy.consecutive_errors
                );
            }
        }
    }

    /// On error: immediately retire the conversation (don't return to active pool).
    /// Queues for delayed deletion.
    pub async fn retire_conv_on_error(&self) {
        let Some(ref org_uuid) = self.org_uuid else { return };
        let Some(ref conv_uuid) = self.conv_uuid else { return };
        // Remove from active pool if it was there
        if let Ok(mut map) = ACTIVE_CONV_MAP.lock() {
            map.retain(|c| c.conv_uuid != *conv_uuid);
        }
        let delay = 30 + (uuid::Uuid::new_v4().as_bytes()[0] as u64 % 90);
        if let Ok(mut queue) = CLEANUP_QUEUE.lock() {
            queue.push(PendingCleanup {
                org_uuid: org_uuid.clone(),
                conv_uuid: conv_uuid.clone(),
                cookie_key: self.cookie_cache_key(),
                queued_at: std::time::Instant::now(),
                delay_secs: delay,
            });
        }
        self.process_cleanup_queue().await;
    }

    /// After a successful request: return conversation to active pool for reuse.
    /// Only queues for deletion when the conversation is retired (msg limit or error).
    pub async fn clean_chat(&self) -> Result<(), ClewdrError> {
        if CLEWDR_CONFIG.load().preserve_chats {
            return Ok(());
        }
        let Some(ref org_uuid) = self.org_uuid else {
            return Ok(());
        };
        let Some(ref conv_uuid) = self.conv_uuid else {
            return Ok(());
        };

        let new_count = self.active_conv_msg_count + 1;

        if new_count < ACTIVE_CONV_MAX_MSGS {
            // Accumulate tokens: previous cached + this request's input + output
            let new_cumulative = self.reused_conv_tokens
                + self.usage.input_tokens
                + self.usage.output_tokens
                + self.usage.cache_creation_input_tokens;
            // Return to active pool for reuse
            if let Ok(mut map) = ACTIVE_CONV_MAP.lock() {
                map.push(ActiveConv {
                    org_uuid: org_uuid.clone(),
                    conv_uuid: conv_uuid.clone(),
                    pool_key: self.conv_pool_key(),
                    msg_count: new_count,
                    cumulative_tokens: new_cumulative,
                    last_used_at: std::time::Instant::now(),
                    created_at: std::time::Instant::now(),
                });
                info!(
                    "[ACTIVE-CONV] returned {} to pool (msg {}/{}, cumulative_tokens={})",
                    conv_uuid, new_count, ACTIVE_CONV_MAX_MSGS, new_cumulative
                );
            }
        } else {
            // Conversation hit message limit — retire it with delayed deletion
            info!(
                "[ACTIVE-CONV] retiring {} after {} messages, queuing deletion",
                conv_uuid, new_count
            );
            let delay = 30 + (uuid::Uuid::new_v4().as_bytes()[0] as u64 % 90);
            if let Ok(mut queue) = CLEANUP_QUEUE.lock() {
                queue.push(PendingCleanup {
                    org_uuid: org_uuid.clone(),
                    conv_uuid: conv_uuid.clone(),
                    cookie_key: self.cookie_cache_key(),
                    queued_at: std::time::Instant::now(),
                    delay_secs: delay,
                });
            }
        }

        // Process any conversations that are past their delay
        self.process_cleanup_queue().await;

        Ok(())
    }

    /// Process the cleanup queue — delete conversations that have waited long enough
    async fn process_cleanup_queue(&self) {
        let ready: Vec<PendingCleanup> = {
            let Ok(mut queue) = CLEANUP_QUEUE.lock() else {
                return;
            };
            let mut ready = Vec::new();
            let mut remaining = Vec::new();
            for item in queue.drain(..) {
                if item.queued_at.elapsed().as_secs() >= item.delay_secs {
                    ready.push(item);
                } else {
                    remaining.push(item);
                }
            }
            *queue = remaining;
            ready
        };

        for item in ready {
            let endpoint = self
                .endpoint
                .join(&format!(
                    "api/organizations/{}/chat_conversations/{}",
                    item.org_uuid, item.conv_uuid
                ))
                .expect("Url parse error");
            debug!("Delayed-deleting chat: {}", item.conv_uuid);
            let _ = self.build_request(Method::DELETE, endpoint).send().await;
        }
    }
}
