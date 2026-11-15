# Connector documentation and access boundaries

Official documentation reviewed on 24 October 2026. Documentation availability is not evidence of a connected account, project access, a tested adapter or a live vehicle integration. All PleosFlows connections remain local simulations or disabled catalog entries.

## OpenAPI targets

- [Google Calendar push notifications](https://developers.google.com/workspace/calendar/api/guides/push): notifications signal resource changes; an application must fetch changes. Starting-soon schedule alerts need an application scheduler.
- [Google Sheets API concepts](https://developers.google.com/workspace/sheets/api/guides/concepts) and [Apps Script installable triggers](https://developers.google.com/apps-script/guides/triggers/installable): row/cell access is supported; row-change detection needs an adapter/polling or an appropriate script design. API/script changes do not universally fire edit triggers.
- [Slack Events API](https://docs.slack.dev/apis/events-api/): input events require configured app scopes and delivery handling. Message output is a distinct capability requiring appropriate authorization.
- [Discord developer documentation](https://discord.com/developers/docs/intro): commands/interactions and webhooks are separate input/output integration paths. The demo does not read arbitrary private chat or configure webhooks.

## Vehicle integration

- [Pleos project and API access guide](https://document.pleos.ai/en/docs/pleos-only/create-my-project): confirm project, emulator/device, API availability and permissions before implementation. Vehicle State is available at the platform level; actual project/vehicle validation is still required. FusedLocation has documentation but is marked Not Available Yet in the access guidance.
- [Pleos Vehicle Data API introduction](https://document.pleos.ai/en/api-reference/vehicle-data-api/intro): the cloud Vehicle Data API is distinct from the on-vehicle Pleos Connect SDK and is described as Europe-only in current guidance. This restriction must not be casually generalized to separate Fleet APIs. No cloud or native vehicle API is connected in this demo.

## Partnership and future expansion

- [Kakao AlimTalk business guide](https://kakaobusiness.gitbook.io/main/ad/infotalk): customer notifications need the relevant business/dealer/template/consent preparation. Generic Kakao Talk message access is not interchangeable with customer business notifications.
- [KidsNote official site](https://www.kidsnote.com/): an official public developer contract and project-access path were not established in this review. This does not prove that partner APIs do not exist. The registry remains catalog-only until partnership, consent and scope are confirmed.
- “스쿨버스” is not treated as an identified provider. Exact product/business identity is needed before choosing documentation or claiming API support.
- Payments are a future extension possibility only. No provider, partnership, API access, commercial agreement or transaction capability has been established.

## Product positioning reference

- [IFTTT AI Agent](https://ifttt.com/ai_agent): AI-assisted automation already exists in the broader category. PleosFlows's proposed differentiator is mobility job context, reliable execution, bounded permissions and reviewable customer outputs, not the mere addition of AI.
