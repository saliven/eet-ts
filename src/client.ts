import { randomUUID } from "node:crypto";
import {
  EET_MAX_SOAP_BYTES,
  EET_PLAYGROUND_ENDPOINT,
  EET_SOAP_ACTION,
  Environment,
} from "./constants.ts";
import { parseEetResponse } from "./response.ts";
import { WsSecuritySigner } from "./signing.ts";
import { HttpsEetTransport } from "./transport.ts";
import type {
  BuildSignedRequestOptions,
  EetClientOptions,
  EetEnvironmentInput,
  EetRequestOptions,
  EetSigner,
  EetSubmissionResult,
  EetTransport,
  RegisterSaleInput,
  SignedEetRequest,
} from "./types.ts";
import { normalizeSale } from "./validation.ts";
import { buildTrzbaXml, buildUnsignedSoapEnvelope } from "./xml.ts";

export class EetClient {
  private readonly options: EetClientOptions;
  private readonly signer: EetSigner;
  private readonly transport: EetTransport;

  constructor(options: EetClientOptions) {
    this.options = options;
    this.signer = options.signer ?? new WsSecuritySigner();
    this.transport = options.transport ?? new HttpsEetTransport();
  }

  registerSale(
    input: RegisterSaleInput,
    options: EetRequestOptions = {},
  ): Promise<EetSubmissionResult> {
    return this.submit(input, false, options);
  }

  verifySale(
    input: RegisterSaleInput,
    options: EetRequestOptions = {},
  ): Promise<EetSubmissionResult> {
    return this.submit(input, true, options);
  }

  async buildSignedRequest(
    input: RegisterSaleInput,
    options: BuildSignedRequestOptions = {},
  ): Promise<SignedEetRequest> {
    const taxpayer = options.taxpayer ?? this.options.taxpayer;

    if (!taxpayer) {
      throw new Error(
        "EET sale requires a taxpayer: pass one to the EetClient or to the request",
      );
    }

    const sale = normalizeSale(input, {
      taxpayer,
      verification: options.verification ?? false,
      now: this.options.now ?? (() => new Date()),
      uuid: this.options.uuid ?? randomUUID,
    });

    const bodyId = `Body-${sale.uuid}`;
    const bodyXml = buildTrzbaXml(sale);
    const unsignedEnvelope = buildUnsignedSoapEnvelope(bodyXml, bodyId);
    const signedEnvelope = await this.signer.sign(
      unsignedEnvelope,
      taxpayer.certificate,
    );
    const byteLength = Buffer.byteLength(signedEnvelope, "utf8");

    if (byteLength > EET_MAX_SOAP_BYTES) {
      throw new Error(
        `Signed EET SOAP message is too large: ${byteLength} bytes`,
      );
    }

    return {
      xml: signedEnvelope,
      uuid: sale.uuid,
      endpoint: resolveEndpoint(this.options.environment),
      soapAction: EET_SOAP_ACTION,
    };
  }

  parseResponse(
    xml: string,
    headers: Record<string, string | string[] | undefined> = {},
  ): EetSubmissionResult {
    return parseEetResponse({ statusCode: 200, body: xml, headers });
  }

  private async submit(
    input: RegisterSaleInput,
    verification: boolean,
    options: EetRequestOptions,
  ): Promise<EetSubmissionResult> {
    const request = await this.buildSignedRequest(input, {
      ...options,
      verification,
    });
    const response = await this.transport.send({
      endpoint: request.endpoint,
      soapAction: request.soapAction,
      xml: request.xml,
      timeoutMs: this.options.timeoutMs,
    });

    return parseEetResponse(response);
  }
}

export function resolveEndpoint(environment: EetEnvironmentInput): string {
  if (environment === Environment.Playground) {
    return EET_PLAYGROUND_ENDPOINT;
  }

  if (environment === Environment.Production) {
    throw new Error(
      "The official EET production endpoint is not bundled yet. Pass { endpoint: 'https://...' } as environment.",
    );
  }

  return environment.endpoint;
}
