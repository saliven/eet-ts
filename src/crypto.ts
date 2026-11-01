import forge from "node-forge";
import { binaryToBytes, bytesToBinary } from "./bytes.ts";
import type { EetCertificate } from "./certificate.ts";
import type { EetCrypto } from "./types.ts";

type Crypto = typeof globalThis.crypto;
type SubtleCrypto = Crypto["subtle"];
type CryptoKey = Awaited<ReturnType<SubtleCrypto["importKey"]>>;

const RSA_SHA256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/**
 * Web Crypto (`crypto.subtle`): Node, Bun, Deno, browsers, and React Native
 * with a polyfill such as react-native-quick-crypto.
 */
export class WebCryptoEetCrypto implements EetCrypto {
  private readonly subtle: SubtleCrypto;
  private readonly keys = new WeakMap<EetCertificate, Promise<CryptoKey>>();

  constructor(subtle: SubtleCrypto = globalThis.crypto.subtle) {
    this.subtle = subtle;
  }

  async sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    return new Uint8Array(await this.subtle.digest("SHA-256", data));
  }

  async signRsaSha256(
    data: Uint8Array<ArrayBuffer>,
    certificate: EetCertificate,
  ): Promise<Uint8Array> {
    const key = await this.privateKey(certificate);
    return new Uint8Array(await this.subtle.sign(RSA_SHA256, key, data));
  }

  private privateKey(certificate: EetCertificate): Promise<CryptoKey> {
    let key = this.keys.get(certificate);

    if (key === undefined) {
      key = this.subtle.importKey(
        "pkcs8",
        pemToPkcs8(certificate.material.privateKeyPem),
        RSA_SHA256,
        false,
        ["sign"],
      );
      this.keys.set(certificate, key);
    }

    return key;
  }
}

/** Pure JavaScript (node-forge). Works anywhere, including Hermes without polyfills. */
export class ForgeEetCrypto implements EetCrypto {
  private readonly keys = new WeakMap<
    EetCertificate,
    forge.pki.rsa.PrivateKey
  >();

  sha256(data: Uint8Array): Uint8Array {
    return binaryToBytes(sha256Digest(data).digest().getBytes());
  }

  signRsaSha256(data: Uint8Array, certificate: EetCertificate): Uint8Array {
    return binaryToBytes(
      this.privateKey(certificate).sign(sha256Digest(data)),
    );
  }

  private privateKey(certificate: EetCertificate): forge.pki.rsa.PrivateKey {
    let key = this.keys.get(certificate);

    if (key === undefined) {
      key = forge.pki.privateKeyFromPem(certificate.material.privateKeyPem);
      this.keys.set(certificate, key);
    }

    return key;
  }
}

export function defaultEetCrypto(): EetCrypto {
  return typeof globalThis.crypto?.subtle?.sign === "function"
    ? new WebCryptoEetCrypto()
    : new ForgeEetCrypto();
}

export function randomUuid(): string {
  const webCrypto = globalThis.crypto as Partial<Crypto> | undefined;

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  if (typeof webCrypto?.getRandomValues !== "function") {
    throw new Error(
      "No crypto.getRandomValues available to generate EET UUIDs: install a polyfill such as react-native-get-random-values or pass `uuid` to the EetClient",
    );
  }

  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10, 16),
  ]
    .map((group) => group.join(""))
    .join("-");
}

function sha256Digest(data: Uint8Array): forge.md.MessageDigest {
  return forge.md.sha256.create().update(bytesToBinary(data));
}

function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const privateKeyInfo = forge.pki.wrapRsaPrivateKey(
    forge.pki.privateKeyToAsn1(forge.pki.privateKeyFromPem(pem)),
  );
  return binaryToBytes(forge.asn1.toDer(privateKeyInfo).getBytes());
}
