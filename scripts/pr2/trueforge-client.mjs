export class BoundedHttpError extends Error {
  constructor(code, status = 0) {
    super(`${code}:${status}`);
    this.name = 'BoundedHttpError';
    this.code = code;
    this.status = status;
  }
}

export class TrueForgeClient {
  constructor({ baseUrl = 'http://127.0.0.1:8790', fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(method, path, body, timeoutMs = this.timeoutMs) {
    let response;
    try {
      response = await this.fetchImpl(new URL(path, this.baseUrl), {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new BoundedHttpError(error?.name === 'TimeoutError' ? 'TIMEOUT' : 'UNAVAILABLE');
    }
    if (!response.ok) throw new BoundedHttpError('HTTP_REJECTED', response.status);
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new BoundedHttpError('INVALID_JSON_RESPONSE', response.status);
    }
  }

  async providersConfigured() {
    const observeProvider = async path => {
      try {
        return await this.request('GET', path);
      } catch (error) {
        if (error instanceof BoundedHttpError && error.status === 404) return null;
        throw error;
      }
    };
    const [model, sandbox] = await Promise.all([
      observeProvider('/api/v1/settings/model-providers'),
      observeProvider('/api/v1/settings/sandbox-providers'),
    ]);
    const modelData = model?.data;
    const sandboxData = sandbox?.data;
    const modelConfigured = Array.isArray(modelData)
      ? modelData.length > 0
      : modelData !== null && typeof modelData === 'object' && Object.keys(modelData).length > 0;
    const sandboxConfigured = Array.isArray(sandboxData)
      ? sandboxData.length > 0
      : sandboxData !== null && typeof sandboxData === 'object' && Object.keys(sandboxData).length > 0;
    return modelConfigured && sandboxConfigured;
  }

  async createSession(expectedExecArguments) {
    const exactArguments = JSON.stringify(expectedExecArguments);
    const body = await this.request('POST', '/api/v1/sessions', {
      agent: {
        spec: {
          model: {
            name: process.env.TRUEFORGE_MODEL ?? 'anthropic/claude-haiku-4-5',
            params: { max_tokens: 4096, temperature: 0 },
          },
          instructions:
            'This is a bounded execution relay. Call truefoundry-system exec exactly once. ' +
            `Use this exact JSON argument object without changing one byte of command: ${exactArguments}. ` +
            'Do not call any other tool. After the tool response, return only EXECUTION_RELAY_COMPLETE.',
          config: { iteration_limit: 3, sandbox: { enabled: true } },
        },
      },
    });
    const id = body?.data?.id;
    if (typeof id !== 'string' || id.length === 0) throw new BoundedHttpError('SESSION_ID_ABSENT');
    return id;
  }

  async createTurn(sessionId, executionRequest, expectedExecArguments, timeoutMs) {
    const body = await this.request('POST', `/api/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
      input: [{
        type: 'user.message',
        content:
          `Execution request: ${JSON.stringify(executionRequest)}. ` +
          `Call exec exactly once with ${JSON.stringify(expectedExecArguments)}.`,
      }],
      stream: false,
    }, timeoutMs);
    const id = body?.data?.id;
    if (typeof id !== 'string' || id.length === 0) throw new BoundedHttpError('TURN_ID_ABSENT');
    return id;
  }

  async getTurn(sessionId, turnId, timeoutMs) {
    return (await this.request(
      'GET',
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}`,
      undefined,
      timeoutMs,
    ))?.data;
  }

  async listEvents(sessionId, turnId, timeoutMs = 5_000) {
    return (await this.request(
      'GET',
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/events`,
      undefined,
      timeoutMs,
    ))?.data ?? [];
  }

  async cancelSession(sessionId) {
    try {
      await this.request('POST', `/api/v1/sessions/${encodeURIComponent(sessionId)}/cancel`, {});
    } catch {
      // Cancellation is best effort; the bounded reducer still records TURN_NOT_DONE.
    }
  }
}
