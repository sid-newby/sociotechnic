# Identity and session readiness

Use this reference for identity questions or when a future task actually needs
Azure access. Advice, architecture, code review and configuration planning can
remain entirely informational. Do not turn an explanation into an onboarding
exercise. Installation and validation of this SME require no authentication.

## Choose the support level

| Need | Response |
| --- | --- |
| Explain OAuth, permissions, certificates or an error using supplied evidence | Answer from the repository and current documentation; no tenant connection |
| Help someone prepare a session | Explain the intended identity, required access and user steps before any login |
| Inspect a tenant or resource | Confirm the authorized target and use the appropriate executing role; use read-only queries first |
| Create an app, grant access, rotate a credential or repair a configuration | Work within explicit mutation scope; preserve approval and verification boundaries |

Separate authentication from authorization. Establish which identity signed in,
which tenant/cloud issued the token, which service/audience is being called, and
which operation and scope were allowed. An Entra app registration, its tenant
service principal, Azure RBAC, directory roles and API consent serve different
purposes. Azure management-plane access does not automatically grant data-plane
or Microsoft Graph access. Do not suggest Owner or Global Administrator as a
generic fix for a 401/403.

## Guide a future first session

Identify the task, execution host, cloud, tenant, subscription, resource scope
and whether a user or workload should act. Reuse context already supplied; ask
only for missing decisions. Present the proposed identity and smallest sufficient
access, who must approve it, and how success will be verified. A shell-free
advisor supplies steps for the user or an executor rather than pretending to
run them. A blocked identity action is not a reason to withhold useful advice.

For an authorized local human session, explain browser-based `az login --tenant
<tenant-id>`; offer device-code login only where supported and permitted by the
organization. The user completes sign-in, MFA and any consent in the official
flow. Never request passwords, device codes, authorization codes, access/refresh
tokens or private keys in chat. Do not bypass Conditional Access or automate a
user/password flow around MFA. Confirm the chosen subscription without changing
global defaults when an explicit `--subscription` argument suffices. Sovereign
cloud selection, proxy and tenant restrictions must match the intended context.

For future unattended operation, prefer managed identity where the host supports
it or workload identity federation for supported CI/external workloads. Use a
service principal with a certificate when suitable and federation is unavailable.
A client secret is a deliberate fallback with an owner, storage and rotation
plan, not an onboarding default. Managed identities are tied to their hosting
environment; do not claim a laptop has one. `az` and `azd` have separate session
requirements; availability or login to one does not establish the other.

After an authorized sign-in, use a minimal scoped query to verify the intended
identity's actual access; redact identifiers where appropriate. CLI installation
or a successful login proves neither resource permissions nor deployment success.
Do not print token caches or use token/credential dump commands as health checks.

## OAuth and application identity

Read the pinned Entra workflow for app registration, MSAL and configuration.
Choose the flow for the actual client: authorization code with PKCE for supported
interactive clients, and client credentials for appropriate app-only workloads.
Use supported identity libraries. Do not enable implicit grant or put a client
secret/private key in a SPA, browser bundle, mobile app or other public client
because a generic example suggests it. Match redirect URIs and account tenancy
to the application's actual endpoints and audiences.

Distinguish delegated scopes acting for a signed-in user from application
permissions acting without a user. Explain which permissions require admin
consent and who can approve them under current tenant policy. An Azure RBAC
assignment is not API consent, and API consent is not directory admin access.
Generic Graph permission examples in upstream references are examples, not a
recommended baseline; derive scopes from the specific API operation.

For federated credentials, verify the issuer, subject and audience against the
actual CI/workload environment. For certificate authentication, distinguish the
public certificate registered with Entra from the private signing key retained
securely by the workload. A TLS server certificate and an application credential
certificate solve different problems. Plan issuance, expiration, chain/trust as
applicable, storage/access, rotation overlap, verification and retirement of the
old credential. Never paste PEM private keys, PFX passwords, client-secret values
or connection strings into chat, source control, command arguments or records.

## Diagnose without granting broad access

Use redacted error codes, timestamps/correlation IDs, target operation, identity
type, nonsecret configuration and effective scope as evidence. Trace failures to
wrong tenant/cloud/audience, redirect configuration, credential expiry, consent,
role/data-plane scope, Conditional Access or propagation before proposing a fix.
Do not weaken TLS validation, disable MFA or add broad grants to silence an error.
State what is observed and what still needs a user/administrator decision.

Keep an operational handoff concrete: identity type, nonsecret identifiers where
needed, credential reference/location rather than value, role/permission and
scope, approver, verification operation, expiry/rotation owner and cleanup path.
User guidance is sufficient when no execution is requested. Never claim tenant
onboarding or access has been verified from an informational discussion.

## Official references

Checked October 24, 2026; refresh details for the target before execution:

- [Azure CLI authentication](https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli)
- [Permissions and consent](https://learn.microsoft.com/en-us/entra/identity-platform/permissions-consent-overview)
- [Authorization code flow and PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Certificate credentials](https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials)
- [Azure RBAC](https://learn.microsoft.com/en-us/azure/role-based-access-control/overview)
- [Workload identity federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation)
