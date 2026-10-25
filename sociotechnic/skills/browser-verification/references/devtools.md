# Chrome DevTools CLI 1.12.0

The runner sets `CD4A_INTERNAL_DAEMON_SESSION_ID` to a dispatch-specific hex ID.
The pinned CLI uses it to scope its daemon socket and process; leave it unchanged.
It also disables usage statistics and update checks. Start this session once:

```sh
chrome-devtools start --headless --isolated --executablePath "$SOCIOTECHNIC_BROWSER_EXECUTABLE_PATH" --no-usage-statistics --no-performance-crux --allowUnrestrictedPaths=false --filesystemRoot "$SOCIOTECHNIC_BROWSER_OUTPUTS"
chrome-devtools new_page http://127.0.0.1:3000 --background true
chrome-devtools list_pages
```

Replace the example URL with the repository's actual development server. Use the
returned page ID, then get element UIDs from a fresh snapshot:

```sh
chrome-devtools take_snapshot 1
chrome-devtools click 1 "the-observed-uid" --includeSnapshot true
chrome-devtools list_console_messages 1 --types error warn --pageSize 20
chrome-devtools list_network_requests 1 --pageSize 20
chrome-devtools get_network_request 1 42
chrome-devtools get_css_styles 1 "the-observed-uid"
```

Use only request IDs and UIDs returned by the session. For performance diagnostics:

```sh
chrome-devtools performance_start_trace 1 --reload true --autoStop true --filePath "$SOCIOTECHNIC_BROWSER_OUTPUTS/trace.json.gz"
chrome-devtools take_screenshot 1 --filePath "$SOCIOTECHNIC_BROWSER_OUTPUTS/page.png"
```

Browser actions and trace reloads must stay within the approved verification
scope. A trace measures that local run; do not present it as production telemetry.
Use each command's `--help` when flags are unclear. The runner stops this session
on exit; a manual early stop must use the same scoped environment.
