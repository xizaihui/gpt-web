// Tool simulation layer for ClewdR
// Converts API tool definitions to system prompt instructions,
// and parses model text output into proper tool_use content blocks.

use serde_json::Value;
use crate::types::claude::{ContentBlock, CreateMessageParams, Message, MessageContent, Role};

/// Format for injecting tool definitions into system prompt
const TOOL_PROMPT_PREFIX: &str = r#"

<tools>
You have access to the following tools. To call a tool, output an XML block in exactly this format:

<tool_call>
<tool_name>TOOL_NAME</tool_name>
<parameters>
{"param1": "value1", "param2": "value2"}
</parameters>
</tool_call>

You may call multiple tools in one response. After outputting tool_call blocks, stop and wait for tool results.

Available tools:
"#;

const TOOL_PROMPT_SUFFIX: &str = "\n</tools>\n";

/// Inject tool definitions into the system prompt of a request
pub fn inject_tools_into_system(body: &mut CreateMessageParams) {
    let tools = match body.tools.take() {
        Some(t) if !t.is_empty() => t,
        _ => return,
    };
    // Also take tool_choice for reference
    let _tool_choice = body.tool_choice.take();

    let mut tool_text = TOOL_PROMPT_PREFIX.to_string();
    for tool in &tools {
        let tool_json = serde_json::to_value(tool).unwrap_or_default();
        // Handle both Anthropic format (name/input_schema) and OpenAI format (function.name/parameters)
        let (name, desc, schema) = if let Some(func) = tool_json.get("function") {
            (
                func.get("name").and_then(|v| v.as_str()).unwrap_or("unknown"),
                func.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                func.get("parameters").cloned().unwrap_or_default(),
            )
        } else {
            (
                tool_json.get("name").and_then(|v| v.as_str()).unwrap_or("unknown"),
                tool_json.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                tool_json.get("input_schema").cloned().unwrap_or_default(),
            )
        };

        tool_text.push_str(&format!(
            "\n<tool>\n<name>{}</name>\n<description>{}</description>\n<input_schema>\n{}\n</input_schema>\n</tool>\n",
            name, desc,
            serde_json::to_string_pretty(&schema).unwrap_or_default()
        ));
    }
    tool_text.push_str(TOOL_PROMPT_SUFFIX);

    // Append to existing system
    match &mut body.system {
        Some(Value::String(s)) => {
            s.push_str(&tool_text);
        }
        Some(Value::Array(arr)) => {
            arr.push(serde_json::json!({"type": "text", "text": tool_text}));
        }
        _ => {
            body.system = Some(Value::String(tool_text));
        }
    }
}

/// Convert tool_result messages from the API format to text for the prompt
/// OpenClaw sends: {role: "user", content: [{type: "tool_result", tool_use_id: "...", content: "..."}]}
/// We convert to: {role: "user", content: "<tool_result tool_use_id=\"...\">CONTENT</tool_result>"}
pub fn convert_tool_results_to_text(body: &mut CreateMessageParams) {
    for msg in &mut body.messages {
        if msg.role != Role::User {
            continue;
        }
        if let MessageContent::Blocks { ref content } = msg.content {
            let mut has_tool_result = false;
            let mut text_parts = Vec::new();

            for block in content {
                match block {
                    ContentBlock::ToolResult { tool_use_id, content: result_content, is_error, .. } => {
                        has_tool_result = true;
                        let content_str = match result_content {
                            Value::String(s) => s.clone(),
                            Value::Array(arr) => {
                                arr.iter()
                                    .filter_map(|v| v.get("text").and_then(|t| t.as_str()))
                                    .collect::<Vec<_>>()
                                    .join("\n")
                            }
                            _ => serde_json::to_string(result_content).unwrap_or_default(),
                        };
                        let error_attr = if is_error.unwrap_or(false) { " is_error=\"true\"" } else { "" };
                        text_parts.push(format!(
                            "<tool_result tool_use_id=\"{}\"{}>\n{}\n</tool_result>",
                            tool_use_id, error_attr, content_str
                        ));
                    }
                    ContentBlock::Text { text, .. } => {
                        text_parts.push(text.clone());
                    }
                    _ => {}
                }
            }

            if has_tool_result {
                msg.content = MessageContent::Text {
                    content: text_parts.join("\n\n"),
                };
            }
        }
    }
}

/// Convert assistant messages containing tool_use blocks to text format
/// This handles the conversation history where previous assistant messages
/// had tool_use calls — convert them to XML text so the prompt stays consistent
pub fn convert_tool_use_history_to_text(body: &mut CreateMessageParams) {
    for msg in &mut body.messages {
        if msg.role != Role::Assistant {
            continue;
        }
        if let MessageContent::Blocks { ref content } = msg.content {
            let mut has_tool_use = false;
            let mut text_parts = Vec::new();

            for block in content {
                match block {
                    ContentBlock::ToolUse { id, name, input, .. } => {
                        has_tool_use = true;
                        text_parts.push(format!(
                            "<tool_call>\n<tool_name>{}</tool_name>\n<parameters>\n{}\n</parameters>\n</tool_call>",
                            name,
                            serde_json::to_string(input).unwrap_or_default()
                        ));
                    }
                    ContentBlock::Text { text, .. } => {
                        text_parts.push(text.clone());
                    }
                    _ => {}
                }
            }

            if has_tool_use {
                msg.content = MessageContent::Text {
                    content: text_parts.join("\n\n"),
                };
            }
        }
    }
}

/// Parse tool_call XML from model text output and return tool_use content blocks
/// Returns (text_before, tool_calls) where tool_calls is a vec of ToolUse blocks
pub fn parse_tool_calls_from_text(text: &str) -> (String, Vec<ContentBlock>) {
    let mut tool_calls = Vec::new();
    let mut remaining = String::new();
    let mut rest = text;

    loop {
        match rest.find("<tool_call>") {
            None => {
                remaining.push_str(rest);
                break;
            }
            Some(start) => {
                remaining.push_str(&rest[..start]);
                let after_start = &rest[start..];
                match after_start.find("</tool_call>") {
                    None => {
                        // Incomplete tool_call, keep as text
                        remaining.push_str(after_start);
                        break;
                    }
                    Some(end) => {
                        let block = &after_start[11..end]; // skip "<tool_call>"
                        if let Some(tc) = parse_single_tool_call(block) {
                            tool_calls.push(tc);
                        } else {
                            // Failed to parse, keep as text
                            remaining.push_str(&after_start[..end + 12]);
                        }
                        rest = &after_start[end + 12..]; // skip "</tool_call>"
                    }
                }
            }
        }
    }

    (remaining.trim().to_string(), tool_calls)
}

fn parse_single_tool_call(block: &str) -> Option<ContentBlock> {
    let name = extract_xml_tag(block, "tool_name")?;
    let params_str = extract_xml_tag(block, "parameters")?;
    let input: Value = serde_json::from_str(params_str.trim()).ok()?;

    // Generate a unique tool_use_id
    let id = format!("toolu_{}", uuid::Uuid::new_v4().simple());

    Some(ContentBlock::ToolUse {
        id,
        name: name.trim().to_string(),
        input,
        cache_control: None,
        caller: None,
    })
}

fn extract_xml_tag<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = text.find(&open)? + open.len();
    let end = text.find(&close)?;
    if start <= end {
        Some(&text[start..end])
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_tool_calls() {
        let text = r#"I'll run that command for you.

<tool_call>
<tool_name>exec</tool_name>
<parameters>
{"command": "ls -la /tmp"}
</parameters>
</tool_call>

Let me check that."#;
        
        let (remaining, calls) = parse_tool_calls_from_text(text);
        assert_eq!(calls.len(), 1);
        assert!(remaining.contains("I'll run that command"));
        assert!(remaining.contains("Let me check that."));
        
        if let ContentBlock::ToolUse { name, input, .. } = &calls[0] {
            assert_eq!(name, "exec");
            assert_eq!(input["command"], "ls -la /tmp");
        } else {
            panic!("Expected ToolUse");
        }
    }
}
