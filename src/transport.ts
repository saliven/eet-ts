import { Agent, request } from "node:https";
import { text } from "node:stream/consumers";
import { URL } from "node:url";
import { EET_SOAP_ACTION } from "./constants.ts";
import type {
  EetTransport,
  EetTransportRequest,
  EetTransportResponse,
} from "./types.ts";
import { EetTransportError } from "./types.ts";

const keepAliveAgent = new Agent({ keepAlive: true });

export class HttpsEetTransport implements EetTransport {
  private readonly agent?: Agent;

  constructor(agent?: Agent) {
    this.agent = agent;
  }

  send(input: EetTransportRequest): Promise<EetTransportResponse> {
    return sendSoapRequest(input, this.agent);
  }
}

export function sendSoapRequest(
  input: EetTransportRequest,
  agent: Agent = keepAliveAgent,
): Promise<EetTransportResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(input.endpoint);
    const body = Buffer.from(input.xml, "utf8");
    const req = request(
      {
        agent,
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        timeout: input.timeoutMs,
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: `"${input.soapAction || EET_SOAP_ACTION}"`,
          Accept: "text/xml",
          "Content-Length": String(body.byteLength),
        },
      },
      (response) => {
        text(response)
          .then((responseBody) => {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: responseBody,
              headers: response.headers,
            });
          })
          .catch((error: unknown) => {
            reject(new EetTransportError("EET response read failed", error));
          });
      },
    );

    req.on("timeout", () => {
      req.destroy(new EetTransportError("EET request timed out"));
    });

    req.on("error", (error) => {
      reject(
        error instanceof EetTransportError
          ? error
          : new EetTransportError("EET request failed", error),
      );
    });

    req.end(body);
  });
}
