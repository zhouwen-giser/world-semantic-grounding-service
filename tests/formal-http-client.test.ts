import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  fetchJsonWithTimeout,
  formalHttpRequestTimeoutMs
} from "../validation/scripts/formal-http-client.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("formal HTTP gate client", () => {
  it("fails closed when a peer accepts a connection without sending headers", async () => {
    const baseUrl = await listen(createServer());
    await expect(fetchJsonWithTimeout(baseUrl, {}, { timeoutMs: 50 }))
      .rejects.toThrow("FORMAL_HTTP_REQUEST_TIMEOUT");
  });

  it("fails closed when a JSON response body never completes", async () => {
    const baseUrl = await listen(createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"status":');
    }));
    await expect(fetchJsonWithTimeout(baseUrl, {}, { timeoutMs: 50 }))
      .rejects.toThrow("FORMAL_HTTP_REQUEST_TIMEOUT");
  });

  it("bounds a request by the remaining poll deadline and preserves valid JSON", async () => {
    const hanging = await listen(createServer());
    await expect(fetchJsonWithTimeout(hanging, {}, {
      timeoutMs: 1_000,
      deadlineAt: Date.now() + 50,
      deadlineTimeoutCode: "EXTERNAL_WORKER_GROUNDING_TIMEOUT"
    })).rejects.toThrow("EXTERNAL_WORKER_GROUNDING_TIMEOUT");

    const healthy = await listen(createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ready"}');
    }));
    const result = await fetchJsonWithTimeout(healthy, {}, { timeoutMs: 1_000 });
    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({ status: "ready" });
    expect(formalHttpRequestTimeoutMs({})).toBe(10_000);
  });

  it("allows an explicit bounded timeout for a synchronous business request", async () => {
    const baseUrl = await listen(createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"status":"COMPLETED"}');
      }, 50);
    }));
    const result = await fetchJsonWithTimeout(baseUrl, {}, {
      timeoutMs: 1_000,
      deadlineAt: Date.now() + 1_000,
      deadlineTimeoutCode: "FORMAL_HTTP_REQUEST_TIMEOUT"
    });
    expect(result.body).toEqual({ status: "COMPLETED" });
  });
});
