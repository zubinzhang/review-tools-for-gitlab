---
stage: AI Clients
group: Developer Clients
info: To determine the technical writer assigned to the Stage/Group associated with this page, see https://about.gitlab.com/handbook/product/ux/technical-writing/#assignments
---

# Testing proxy support

Use this page to test the extension behind an HTTP proxy on your machine, with any GitLab instance you can
reach over HTTPS. GitLab.com works. For certificate-only problems without a proxy, see
[Testing SSL issues](ssl.md).

> [!note]
> The instructions were tested on macOS only.

## How proxy settings reach each process

The extension and the Language Server (LS) are separate processes with separate network stacks.
Most proxy bugs affect only the LS, so check its traffic, not just whether the extension works.

| Setting                                        | Extension             | Language Server                                                             |
| ---------------------------------------------- | --------------------- | --------------------------------------------------------------------------- |
| `http.proxy`, `http.noProxy`                   | VS Code proxy support | Passed as `http_proxy`, `HTTPS_PROXY`, and `NO_PROXY` environment variables |
| `HTTPS_PROXY`, `http_proxy`, `NO_PROXY`        | VS Code proxy support | Used when `http.proxy` or `http.noProxy` is not set                         |
| `http.proxyAuthorization`                      | VS Code proxy support | Not passed. Put credentials in the proxy URL instead.                       |
| macOS system proxy or proxy auto-configuration | VS Code proxy support | Ignored                                                                     |

The extension reads these settings when it starts the LS. After you change one, run
**Developer: Reload Window**.

## Install the proxies

Neither proxy is in the project's `mise` configuration.

```shell
brew install tinyproxy mitmproxy
```

On Linux, use `apt install tinyproxy` and `pipx install mitmproxy`.

- `tinyproxy`: a plain CONNECT proxy. It tunnels TLS without decrypting it, and supports basic authentication.
- `mitmproxy`: a TLS-inspecting proxy, like the SSL inspection proxies many enterprises run.
  It re-signs traffic with its own CA, which is created in `~/.mitmproxy/` the first time it runs.

## Run the proxies

Run each proxy in the foreground, in its own terminal, so you can see the requests arrive.

**`tinyproxy`**:

```shell
cat > /tmp/tinyproxy.conf <<'EOF'
Port 18080
Listen 127.0.0.1
LogLevel Connect
Allow 127.0.0.1
ConnectPort 443
# Uncomment to require credentials:
# BasicAuth user secret
EOF
tinyproxy -d -c /tmp/tinyproxy.conf
```

Each tunnel shows up as a `CONNECT <host>:443` line.

**`mitmproxy`**:

```shell
mitmweb --listen-host 127.0.0.1 --listen-port 18080
```

The web UI opens at `http://127.0.0.1:8081`. Enter `~hq gitlab-language-server` in the search field to show
only LS requests. The LS sends a User-Agent header that starts with `gitlab-language-server`.

If your GitLab instance uses a private CA, add
`--set ssl_verify_upstream_trusted_ca=<bundle.pem>`. This option replaces the default trust store,
so the bundle must also contain the public root certificates.

Before you test with `mitmproxy`, check the trust state of its CA and change it for the scenario you need:

```shell
# Check
security verify-cert -c ~/.mitmproxy/mitmproxy-ca-cert.pem
# Trust
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.mitmproxy/mitmproxy-ca-cert.pem
# Untrust
sudo security remove-trusted-cert -d ~/.mitmproxy/mitmproxy-ca-cert.pem
```

## Configure the extension

Set `http.proxy` in your **User** `settings.json`. `http.proxy` is an application-level setting,
so VS Code ignores it in workspace settings.

```json
{
  "http.proxy": "http://127.0.0.1:18080"
}
```

While this is set, your main VS Code window also uses the proxy. Remove it when you're done.

To set an environment variable such as `NODE_EXTRA_CA_CERTS`, add it to the `env` block of your launch configuration
in `.vscode/launch.json`, then start a new debug session. Reloading the window does not pass on new environment variables.
If you run an installed extension instead, fully quit VS Code first and launch it from a terminal with the variable set.

Before you start, run `scutil --proxy` to check for an active system proxy or proxy auto-configuration, which can
send traffic somewhere you don't expect.

## Scenarios

For each scenario, test code suggestions, GitLab Duo Chat, and a GitLab Duo Agent Platform flow. The Agent Platform flow
uses a WebSocket, which takes a different code path from the other requests.

Check the following:

- The `GitLab Language Server` output tab contains `fetch: Detected http proxy through settings` and has no TLS errors.
- The proxy shows LS requests.

| #   | Proxy                                    | Setup                                                                               | Expected                                                                                                          |
| --- | ---------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `tinyproxy`                              | `"http.proxy": "http://127.0.0.1:18080"`                                            | Works. If you stop the proxy, LS requests fail, which proves nothing bypasses it.                                 |
| 2   | `tinyproxy` with `BasicAuth user secret` | `"http.proxy": "http://user:secret@127.0.0.1:18080"`                                | Works. The log masks the password as `user:***@`. With a wrong password, you get a clear `407` error, not a hang. |
| 3   | `mitmproxy`                              | Scenario 1 setup, `mitmproxy` CA trusted                                            | Works, because the LS trusts the system CA store                                                                  |
| 4   | `mitmproxy`                              | Scenario 1 setup, `mitmproxy` CA untrusted                                          | Certificate error in the `GitLab Language Server` output tab                                                      |
| 5   | `mitmproxy`                              | Scenario 4 setup, `NODE_EXTRA_CA_CERTS` set to `~/.mitmproxy/mitmproxy-ca-cert.pem` | Works                                                                                                             |

For the LS side of proxy and certificate handling, see
[Certificate and proxy E2E tests](https://gitlab.com/gitlab-org/editor-extensions/gitlab-lsp/-/blob/main/docs/ai/cert-proxy.md)
in the Language Server project.
