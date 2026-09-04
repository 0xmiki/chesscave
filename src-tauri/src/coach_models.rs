use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Default)]
pub(super) struct ModelRouting {
    models: Vec<Value>,
    account_generation: u64,
    rejected: HashSet<String>,
    discovery_id: Option<u64>,
    stale_discovery_ids: HashSet<u64>,
    deferred_thread: Option<Value>,
    pending: Option<Pending>,
    ignored_turns: HashSet<String>,
}

struct Pending {
    account_generation: u64,
    request: Value,
    turn_id: Option<String>,
    retried: bool,
    produced_output: bool,
}

#[derive(Default)]
pub(super) struct RoutingResult {
    pub outgoing: Option<Value>,
    pub suppress: bool,
}

impl ModelRouting {
    pub fn deferred_thread_for_refresh(&mut self) -> Option<Value> {
        self.deferred_thread.take()
    }

    pub fn discovering(&self) -> bool {
        self.discovery_id.is_some()
    }

    pub fn discover(&mut self, id: u64, thread: Option<Value>) -> Value {
        self.account_generation += 1;
        self.models.clear();
        self.rejected.clear();
        if let Some(previous) = self.discovery_id.replace(id) {
            self.stale_discovery_ids.insert(previous);
        }
        self.deferred_thread = thread;
        json!({"id": id, "method": "model/list", "params": {"includeHidden": false, "limit": 100}})
    }

    fn choose(&self, preferred: &str) -> Option<&Value> {
        let usable = |m: &&Value| {
            m["model"]
                .as_str()
                .is_some_and(|name| !self.rejected.contains(name))
        };
        self.models
            .iter()
            .filter(usable)
            .find(|m| m["model"] == preferred)
            .or_else(|| {
                self.models
                    .iter()
                    .filter(usable)
                    .find(|m| m["model"] == "gpt-5.6-terra")
            })
            .or_else(|| {
                self.models
                    .iter()
                    .filter(usable)
                    .find(|m| m["isDefault"] == true)
            })
    }

    fn select(&self, request: &mut Value) {
        let preferred = request["params"]["model"].as_str().unwrap_or("");
        let selected = self.choose(preferred);
        let params = request["params"].as_object_mut().expect("request params");
        if let Some(model) = selected {
            params.insert("model".into(), model["model"].clone());
            if let Some(effort) = params.get("effort") {
                let supported = model["supportedReasoningEfforts"].as_array();
                if !supported
                    .is_some_and(|items| items.iter().any(|e| &e["reasoningEffort"] == effort))
                {
                    params.remove("effort");
                    if let Some(default) = model["defaultReasoningEffort"].as_str() {
                        params.insert("effort".into(), json!(default));
                    }
                }
            }
            if model["supportsPersonality"] == false {
                params.remove("personality");
            }
        } else {
            // Older servers or an empty catalog: defer model and effort to Codex.
            params.remove("model");
            params.remove("effort");
            params.remove("personality");
        }
    }

    pub fn validate_selection(&self, preferred: &str) -> Result<(), String> {
        if !self.rejected.is_empty() && self.choose(preferred).is_none() {
            return Err("Codex rejected the available coaching models for this account. Check your Codex model access and reconnect.".to_string());
        }
        Ok(())
    }

    pub fn prepare(&mut self, mut request: Value) -> Value {
        self.select(&mut request);
        self.pending = Some(Pending {
            account_generation: self.account_generation,
            request: request.clone(),
            turn_id: None,
            retried: false,
            produced_output: false,
        });
        request
    }

    pub fn busy(&self) -> bool {
        self.pending.is_some()
    }

    pub fn cancel(&mut self) {
        self.pending = None;
    }

    pub fn handle(&mut self, message: &Value, next_id: &mut u64) -> RoutingResult {
        let response_id = message["id"].as_u64();
        if response_id.is_some_and(|id| self.stale_discovery_ids.remove(&id)) {
            return RoutingResult {
                outgoing: None,
                suppress: true,
            };
        }
        if self.discovery_id.is_some() && response_id == self.discovery_id {
            if let Some(data) = message.pointer("/result/data").and_then(Value::as_array) {
                self.models.extend(data.iter().cloned());
            }
            if let Some(cursor) = message
                .pointer("/result/nextCursor")
                .and_then(Value::as_str)
            {
                let id = *next_id;
                *next_id += 1;
                self.discovery_id = Some(id);
                return RoutingResult {
                    outgoing: Some(
                        json!({"id": id, "method": "model/list", "params": {"cursor": cursor, "includeHidden": false, "limit": 100}}),
                    ),
                    suppress: true,
                };
            }
            self.discovery_id = None;
            let outgoing = self
                .deferred_thread
                .take()
                .map(|request| self.prepare(request));
            return RoutingResult {
                outgoing,
                suppress: true,
            };
        }
        let method = message["method"].as_str().unwrap_or("");
        let turn_id = message
            .pointer("/params/turnId")
            .or_else(|| message.pointer("/params/turn/id"))
            .and_then(Value::as_str);
        if turn_id.is_some_and(|id| self.ignored_turns.contains(id)) {
            return RoutingResult {
                suppress: true,
                outgoing: None,
            };
        }
        let Some(pending) = self.pending.as_mut() else {
            return RoutingResult::default();
        };
        let response_matches =
            response_id.is_some() && response_id == pending.request["id"].as_u64();
        if response_matches
            || (method == "turn/started" && pending.request["method"] == "turn/start")
        {
            if let Some(id) = message
                .pointer("/result/turn/id")
                .and_then(Value::as_str)
                .or(turn_id)
            {
                pending.turn_id = Some(id.to_string());
            }
        }
        let turn_matches = turn_id.is_some() && turn_id == pending.turn_id.as_deref();
        if turn_matches && method.starts_with("item/") {
            pending.produced_output = true;
        }
        let error = if response_matches {
            message.get("error")
        } else if turn_matches && method == "turn/completed" {
            message.pointer("/params/turn/error")
        } else if turn_matches && method == "error" {
            message.pointer("/params/error")
        } else {
            None
        };
        let is_thread = pending.request["method"] == "thread/start";
        if let Some(error) = error.filter(|e| !e.is_null()) {
            if pending.account_generation == self.account_generation && is_model_access_error(error)
            {
                if let Some(model) = pending.request["params"]["model"].as_str() {
                    self.rejected.insert(model.to_string());
                }
                // Wait for completion before retrying an accepted turn. Hide only the
                // matching access error; never replay a turn that has produced output.
                if !pending.retried && !pending.produced_output {
                    if method == "error" {
                        return RoutingResult {
                            suppress: true,
                            outgoing: None,
                        };
                    }
                    let mut retry = pending.request.clone();
                    let old_model = retry["params"]["model"].clone();
                    let old_turn = pending.turn_id.clone();
                    self.select(&mut retry);
                    // No explicit usable alternative: don't retry an unknown default
                    // which might resolve to the same rejected model.
                    if !retry["params"]["model"].is_null() && retry["params"]["model"] != old_model
                    {
                        if let Some(id) = old_turn {
                            self.ignored_turns.insert(id);
                        }
                        // Keep thread IDs stable for the startup timeout. Turns get fresh IDs.
                        if retry["method"] == "turn/start" {
                            retry["id"] = json!(*next_id);
                            *next_id += 1;
                        }
                        self.pending = Some(Pending {
                            account_generation: self.account_generation,
                            request: retry.clone(),
                            turn_id: None,
                            retried: true,
                            produced_output: false,
                        });
                        return RoutingResult {
                            outgoing: Some(retry),
                            suppress: true,
                        };
                    }
                }
            }
        }
        if (response_matches && (message.get("error").is_some() || is_thread))
            || (turn_matches && method == "turn/completed")
        {
            self.pending = None;
        }
        RoutingResult::default()
    }
}

fn is_model_access_error(error: &Value) -> bool {
    let text = error.to_string().to_lowercase();
    if [
        "reasoning",
        "service tier",
        "service_tier",
        "tool",
        "quota",
        "rate_limit",
        "rate limit",
        "usage limit",
        "too many requests",
        "429",
    ]
    .iter()
    .any(|s| text.contains(s))
    {
        return false;
    }
    text.contains("model")
        && [
            "not supported",
            "not available",
            "does not exist",
            "not found",
            "model_not_found",
            "do not have access",
            "don't have access",
            "not have access",
            "access denied",
            "not allowed",
        ]
        .iter()
        .any(|s| text.contains(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog(names: &[&str]) -> ModelRouting {
        let mut router = ModelRouting::default();
        router.discover(2, None);
        let data: Vec<_> = names.iter().enumerate().map(|(i, name)| json!({
            "model": name, "isDefault": i == 0,
            "defaultReasoningEffort": "medium",
            "supportedReasoningEfforts": [{"reasoningEffort":"low"}, {"reasoningEffort":"medium"}]
        })).collect();
        router.handle(
            &json!({"id":2,"result":{"data":data,"nextCursor":null}}),
            &mut 3,
        );
        router
    }

    fn turn(model: &str) -> Value {
        json!({"id":10,"method":"turn/start","params":{"threadId":"thread", "model":model,"effort":"high","input":[{"type":"text","text":"Explain this position"}]}})
    }

    #[test]
    fn account_refresh_discards_old_catalog_and_rejected_models() {
        let mut router = catalog(&["gpt-5.6-terra", "gpt-5.6-luna"]);
        router.rejected.insert("gpt-5.6-luna".into());
        router.discover(20, None);
        router.discover(21, None);
        let stale = router.handle(
            &json!({"id":20,"result":{"data":[{"model":"old-account"}]}}),
            &mut 22,
        );
        assert!(stale.suppress);
        assert!(router.discovering());
        router.handle(
            &json!({"id":21,"result":{"data":[{"model":"gpt-5.6-luna","isDefault":true}]}}),
            &mut 22,
        );
        assert!(router.rejected.is_empty());
        assert_eq!(
            router.prepare(turn("gpt-5.6-luna"))["params"]["model"],
            "gpt-5.6-luna"
        );
    }

    #[test]
    fn account_change_does_not_replay_or_blacklist_old_account_request() {
        let mut router = catalog(&["gpt-5.6-terra", "gpt-5.6-luna"]);
        router.prepare(turn("gpt-5.6-luna"));
        router.discover(20, None);
        router.handle(
            &json!({"id":20,"result":{"data":[{"model":"gpt-5.6-terra","isDefault":true}]}}),
            &mut 21,
        );
        let result = router.handle(
            &json!({"id":10,"error":{"message":"model not supported"}}),
            &mut 21,
        );
        assert!(!result.suppress);
        assert!(result.outgoing.is_none());
        assert!(router.rejected.is_empty());
        assert!(!router.busy());
    }

    #[test]
    fn thread_retry_preserves_startup_id_and_only_retries_once() {
        let mut router = catalog(&["other-default", "gpt-5.6-terra"]);
        router.prepare(json!({"id":1,"method":"thread/start","params":{"model":"gpt-5.6-terra"}}));
        let result = router.handle(
            &json!({"id":1,"error":{"message":"model not supported"}}),
            &mut 3,
        );
        let retry = result.outgoing.unwrap();
        assert_eq!(retry["id"], 1);
        assert_eq!(retry["params"]["model"], "other-default");
        let second = router.handle(
            &json!({"id":1,"error":{"message":"model not supported"}}),
            &mut 3,
        );
        assert!(!second.suppress);
        assert!(second.outgoing.is_none());
    }

    #[test]
    fn unrelated_errors_and_missing_alternatives_do_not_retry() {
        let mut router = catalog(&["gpt-5.6-terra"]);
        router.prepare(turn("gpt-5.6-terra"));
        let unrelated = router.handle(
            &json!({"id":99,"error":{"message":"model not supported"}}),
            &mut 11,
        );
        assert!(!unrelated.suppress);
        assert!(router.rejected.is_empty());
        let failed = router.handle(
            &json!({"id":10,"error":{"message":"model not supported"}}),
            &mut 11,
        );
        assert!(!failed.suppress);
        assert!(failed.outgoing.is_none());
    }

    #[test]
    fn terra_only_account_uses_terra_for_live_and_study() {
        let mut router = catalog(&["gpt-5.6-terra"]);
        for preferred in ["gpt-5.6-luna", "gpt-5.6-terra"] {
            let request = router.prepare(turn(preferred));
            assert_eq!(request["params"]["model"], "gpt-5.6-terra");
            assert_eq!(request["params"]["effort"], "medium");
        }
    }

    #[test]
    fn keeps_available_preference_and_supported_effort() {
        let mut router = catalog(&["gpt-5.6-terra", "gpt-5.6-luna"]);
        let mut request = turn("gpt-5.6-luna");
        request["params"]["effort"] = json!("low");
        let selected = router.prepare(request);
        assert_eq!(selected["params"]["model"], "gpt-5.6-luna");
        assert_eq!(selected["params"]["effort"], "low");
    }

    #[test]
    fn uses_catalog_default_and_defers_on_discovery_failure() {
        let mut router = catalog(&["future-default"]);
        assert_eq!(
            router.prepare(turn("gpt-5.6-terra"))["params"]["model"],
            "future-default"
        );
        let mut router = ModelRouting::default();
        router.discover(2, Some(turn("gpt-5.6-terra")));
        let result = router.handle(
            &json!({"id":2,"error":{"message":"Method not found"}}),
            &mut 3,
        );
        let request = result.outgoing.unwrap();
        assert!(request["params"].get("model").is_none());
        assert!(request["params"].get("effort").is_none());
        assert!(result.suppress);
    }

    #[test]
    fn waits_for_all_catalog_pages_before_starting_thread() {
        let mut router = ModelRouting::default();
        let thread = json!({"id":1,"method":"thread/start","params":{"model":"gpt-5.6-terra"}});
        router.discover(2, Some(thread));
        let mut next = 3;
        let first = router.handle(
            &json!({"id":2,"result":{"data":[],"nextCursor":"page2"}}),
            &mut next,
        );
        assert_eq!(first.outgoing.unwrap()["params"]["cursor"], "page2");
        assert!(router.discovering());
        let second = router.handle(&json!({"id":3,"result":{"data":[{"model":"gpt-5.6-terra","isDefault":true}],"nextCursor":null}}), &mut next);
        let request = second.outgoing.unwrap();
        assert_eq!(request["id"], 1);
        assert_eq!(request["params"]["model"], "gpt-5.6-terra");
        assert!(!router.discovering());
    }

    #[test]
    fn retries_access_rejection_once_and_remembers_both_rejected_models() {
        let mut router = catalog(&["gpt-5.6-terra", "gpt-5.6-luna"]);
        let original = router.prepare(turn("gpt-5.6-luna"));
        let mut next = 11;
        let error = json!({"id":10,"error":{"message":"The model gpt-5.6-luna is not supported with your ChatGPT account"}});
        let result = router.handle(&error, &mut next);
        let retry = result.outgoing.unwrap();
        assert!(result.suppress);
        assert_eq!(retry["id"], 11);
        assert_eq!(retry["params"]["model"], "gpt-5.6-terra");
        assert_eq!(retry["params"]["input"], original["params"]["input"]);
        let failed = router.handle(
            &json!({"id":11,"error":{"code":"model_not_found"}}),
            &mut next,
        );
        assert!(!failed.suppress);
        assert!(failed.outgoing.is_none());
        assert_eq!(router.rejected.len(), 2);
        assert!(router.validate_selection("gpt-5.6-luna").is_err());
    }

    #[test]
    fn retries_failed_turn_completion_and_suppresses_old_events() {
        let mut router = catalog(&["gpt-5.6-terra", "gpt-5.6-luna"]);
        router.prepare(turn("gpt-5.6-luna"));
        let mut next = 11;
        router.handle(&json!({"id":10,"result":{"turn":{"id":"old"}}}), &mut next);
        let error = json!({"message":"model is not available for your plan"});
        assert!(
            router
                .handle(
                    &json!({"method":"error","params":{"turnId":"old","error":error}}),
                    &mut next
                )
                .suppress
        );
        let result = router.handle(&json!({"method":"turn/completed","params":{"turn":{"id":"old","status":"failed","error":error}}}), &mut next);
        assert!(result.outgoing.is_some());
        assert!(result.suppress);
        assert!(
            router
                .handle(
                    &json!({"method":"turn/completed","params":{"turn":{"id":"old"}}}),
                    &mut next
                )
                .suppress
        );
    }

    #[test]
    fn never_retries_quota_network_or_generic_auth_errors() {
        for error in [
            "model usage limit reached",
            "model rate limit exceeded",
            "model unavailable: 429",
            "connection reset",
            "401 unauthorized",
            "model reasoning effort is not supported",
        ] {
            let mut router = catalog(&["gpt-5.6-terra", "gpt-5.6-luna"]);
            router.prepare(turn("gpt-5.6-luna"));
            let result = router.handle(&json!({"id":10,"error":{"message":error}}), &mut 11);
            assert!(!result.suppress, "{error}");
            assert!(result.outgoing.is_none(), "{error}");
            assert!(router.rejected.is_empty());
        }
    }

    #[test]
    fn never_replays_output_or_cancelled_turns() {
        for cancel in [false, true] {
            let mut router = catalog(&["gpt-5.6-terra", "gpt-5.6-luna"]);
            router.prepare(turn("gpt-5.6-luna"));
            router.handle(
                &json!({"method":"turn/started","params":{"turn":{"id":"active"}}}),
                &mut 11,
            );
            if cancel {
                router.cancel();
            } else {
                router.handle(&json!({"method":"item/agentMessage/delta","params":{"turnId":"active","delta":"hello"}}), &mut 11);
            }
            let result = router.handle(&json!({"method":"turn/completed","params":{"turn":{"id":"active","error":{"message":"model not available"}}}}), &mut 11);
            assert!(!result.suppress);
            assert!(result.outgoing.is_none());
        }
    }
}
