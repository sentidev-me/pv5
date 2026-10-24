/** Local fixture adapters only. This module has no network, SDK, credentials, or send method. */
export const DEMO_CONNECTORS = Object.freeze(['demo-web', 'slack-demo', 'discord-demo', 'http-demo']);

export class DemoConnectorError extends Error {
  constructor(code, message) { super(message); this.code = code; this.status = 400; }
}

export function normalizeDemoInbound(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DemoConnectorError('INVALID_CONNECTOR_INPUT', '로컬 데모 입력 객체가 필요합니다.');
  if (Object.keys(input).some((key) => !['connector', 'message', 'externalMessageId'].includes(key))) throw new DemoConnectorError('LIVE_CONNECTOR_INPUT_REJECTED', '실제 토큰·웹훅·계정·수신자 정보는 받지 않습니다. 로컬 fixture 입력만 사용해주세요.');
  const { connector = 'demo-web', message, externalMessageId = null } = input;
  if (!DEMO_CONNECTORS.includes(connector)) throw new DemoConnectorError('UNSUPPORTED_CONNECTOR', 'demo-web, slack-demo, discord-demo, http-demo 로컬 입력만 지원합니다.');
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) throw new DemoConnectorError('INVALID_MESSAGE', '데모 메시지는 1–2000자여야 합니다.');
  if (externalMessageId !== null && (typeof externalMessageId !== 'string' || !/^(?:demo|fixture)[-:_][A-Za-z0-9:_-]{1,100}$/.test(externalMessageId))) throw new DemoConnectorError('INVALID_FIXTURE_ID', '외부 메시지 ID는 demo- 또는 fixture-로 시작하는 가상 ID만 허용합니다.');
  return {
    message: message.trim().normalize('NFC'),
    source: { connector, mode: 'mock', transport: 'local-fixture', externalMessageId },
  };
}

export function buildMockNotificationPayload({ connector = 'demo-web', requestId, status, version, title, body, connectionLabel }) {
  if (!DEMO_CONNECTORS.includes(connector)) throw new DemoConnectorError('UNSUPPORTED_CONNECTOR', '실제 커넥터 전송은 지원하지 않습니다.');
  if (connectionLabel !== undefined && (typeof connectionLabel !== 'string' || !/^DEMO_[A-Z0-9_]{1,60}$/.test(connectionLabel))) throw new DemoConnectorError('INVALID_CONNECTION_LABEL', '가상 DEMO_ 연결 이름만 사용합니다.');
  const text = `[MOCK · 외부 발송 없음] ${title}\n${body}`;
  const common = { mode: 'mock', connector, deliveryStatus: 'preview-only', networkEnabled: false, event: { requestId, status, version } };
  if (connector === 'slack-demo') return {
    ...common,
    recipient: { type: 'placeholder', id: connectionLabel || 'DEMO_SLACK_PARENT_CHANNEL' },
    payload: { channel: connectionLabel || 'DEMO_SLACK_PARENT_CHANNEL', text, blocks: [{ type: 'section', text: { type: 'plain_text', text } }], unfurl_links: false, unfurl_media: false },
  };
  if (connector === 'discord-demo') return {
    ...common,
    recipient: { type: 'placeholder', id: connectionLabel || 'DEMO_DISCORD_PARENT_CHANNEL' },
    payload: { content: text, allowed_mentions: { parse: [], users: [], roles: [], replied_user: false } },
  };
  if (connector === 'http-demo') return { ...common, recipient: { type: 'placeholder', id: connectionLabel || 'DEMO_HTTP_RECEIVER' }, payload: { method: 'POST', destination: 'LOCAL_FIXTURE_ONLY', body: { title, body, requestId, status, version } } };
  return { ...common, recipient: { type: 'placeholder', id: connectionLabel || 'DEMO_WEB_PARENT' }, payload: { title, body, text } };
}
